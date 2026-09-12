import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { getErrorMessage } from '../../utils/error.utils';
import { UserDocument } from '../../schemas/user.schema';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { DEVICE_FIELD_MAX_LENGTH, HandshakeIdentity, MintedSession, ResolvedSession, SessionRecord, SessionRecordSchema } from './auth.types';

/** How long a sign-in nonce stays claimable. Long enough for the Google sheet, short enough to be useless later. */
const NONCE_TTL_SECONDS = 300;

/** What `issueNonce` produces, and therefore the only shape `consumeNonce` will look up. */
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

/** Default session lifetime when `AUTH_SESSION_TTL_DAYS` is unset: a phone in a drawer signs out after a season. */
const DEFAULT_TTL_DAYS = 90;

/**
 * How stale `lastSeenAt` may get before a resolve rewrites the record.
 *
 * The TTL is sliding, but refreshing it on literally every request would mean a Redis write per
 * call for no gain: an hour of granularity on a ninety day window is invisible to the user and
 * turns the write into a rounding error.
 */
const SLIDING_REFRESH_AFTER_MS = 60 * 60 * 1000;

/**
 * The socket handshake bag, which is whatever the client put there. Every field is optional and
 * untrusted. The device fields carry the same cap as the sign-in body: one over it is dropped and
 * the session's stored value stands in, rather than the whole handshake being refused.
 */
const HandshakeAuthSchema = z.object({
  token: z.string().optional().catch(undefined),
  deviceId: z.string().max(DEVICE_FIELD_MAX_LENGTH).optional().catch(undefined),
  deviceName: z.string().max(DEVICE_FIELD_MAX_LENGTH).optional().catch(undefined),
  apiKey: z.string().optional().catch(undefined),
  userId: z.string().optional().catch(undefined),
});

/** Last resort for a client that names neither a device id nor a user agent. */
const UNKNOWN_DEVICE = 'Unknown Device';

/**
 * App sessions: minting, resolving, revoking, and the nonce that guards a sign-in.
 *
 * A session is an **opaque bearer token**, not a JWT — 32 random bytes, base64url — and Redis is
 * keyed on its SHA-256, so a Redis dump hands out no live tokens. Revocation is per device
 * (delete the key) and per user (`sessionEpoch`, one `$inc`), which is why there is no set of a
 * user's sessions to keep in step.
 *
 * In Redis rather than Mongo because this is read on every request and every handshake, wants a
 * native TTL, and Redis is already required to boot. The cost is that a Redis restart without
 * persistence signs every phone out, which on a household server is one tap each.
 */
@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);

  /** Session lifetime in seconds, from `AUTH_SESSION_TTL_DAYS`. */
  private readonly ttlSeconds: number;

  constructor(
    private readonly cache: RedisCacheService,
    private readonly users: UserService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    const days = Number(this.configService.get<string>('AUTH_SESSION_TTL_DAYS')) || DEFAULT_TTL_DAYS;
    this.ttlSeconds = Math.floor(days * 86_400);
  }

  /**
   * Issues a single-use nonce for the phone to hand to Google.
   *
   * This is what stops a captured ID token being replayed against a different session: the token
   * Google signs carries the nonce back, and only a nonce this server issued in the last five
   * minutes is accepted.
   *
   * @throws ServiceUnavailableException when Redis would not take the write — a nonce nobody stored
   *   could never be consumed, and failing here is clearer than failing at `POST /auth/google`
   */
  public async issueNonce(): Promise<string> {
    const nonce = randomBytes(16).toString('hex');

    const stored = await this.cache.set(this.nonceKey(nonce), { issuedAt: Date.now() }, NONCE_TTL_SECONDS);
    if (!stored) {
      throw new ServiceUnavailableException('The session store is unavailable, sign-in cannot start.');
    }

    return nonce;
  }

  /**
   * Spends a nonce. Deleting it *is* the check: a second attempt with the same value finds nothing.
   *
   * @throws UnauthorizedException when the nonce is absent, misshapen, expired or already used
   */
  public async consumeNonce(nonce: string | undefined): Promise<void> {
    if (!nonce || !NONCE_PATTERN.test(nonce)) {
      throw new UnauthorizedException('nonce');
    }

    const deleted = await this.cache.delete(this.nonceKey(nonce));
    if (!deleted) {
      throw new UnauthorizedException('nonce');
    }
  }

  /**
   * Mints a session for a user on a device.
   *
   * Takes the `User` document itself: both callers — the sign-in route and `auth session` — have
   * just loaded or saved it, so reading it back here would be a round trip answering a question
   * already in hand. The record carries the user's `sessionEpoch` as it stands now, which is what a
   * later revoke invalidates it against, and the lifetime it was minted with, which is what the
   * sliding refresh renews.
   *
   * @param ttlSecondsOverride - A shorter (or longer) life than `AUTH_SESSION_TTL_DAYS`, for `auth session --ttl`
   * @throws ForbiddenException for a blocked user — a token that would be refused on its first
   *   use is not worth minting, wherever the request came from
   */
  public async mint(owner: UserDocument, device: { deviceId: string; deviceName: string }, ttlSecondsOverride?: number): Promise<MintedSession> {
    if (owner.status === 'blocked') {
      throw new ForbiddenException(`${owner.email} is blocked on this server.`);
    }

    const ttlSeconds = ttlSecondsOverride && ttlSecondsOverride > 0 ? Math.floor(ttlSecondsOverride) : this.ttlSeconds;
    const now = Date.now();
    const token = randomBytes(32).toString('base64url');

    const record: SessionRecord = {
      userId: owner._id.toString(),
      epoch: owner.sessionEpoch,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      createdAt: now,
      lastSeenAt: now,
      ttlSeconds,
    };

    const stored = await this.cache.set(this.sessionKey(this.hash(token)), record, ttlSeconds);
    if (!stored) {
      throw new ServiceUnavailableException('The session store is unavailable, no session could be minted.');
    }

    this.logger.log(`Minted a session for ${owner.email} on "${device.deviceName}" (${device.deviceId}), valid ${Math.round(ttlSeconds / 86_400)}d`);

    return {
      token,
      expiresAt: now + ttlSeconds * 1000,
      user: this.users.toAuthenticated(owner),
    };
  }

  /**
   * Resolves a bearer token to its owner, refreshing the sliding TTL when the record is stale.
   *
   * @returns `null` for anything not currently valid — unknown, expired, owner gone, owner blocked,
   *   or minted before the owner's current epoch. The caller turns that into a 401; this never throws.
   */
  public async resolveToken(token: string): Promise<ResolvedSession | null> {
    if (!token) return null;

    const tokenHash = this.hash(token);
    const key = this.sessionKey(tokenHash);

    const record = await this.cache.get(key, SessionRecordSchema);
    if (!record) return null;

    const owner = await this.users.findById(record.userId);
    if (!owner || owner.status === 'blocked') return null;

    if (record.epoch < owner.sessionEpoch) {
      // Revoked. Drop the key rather than leaving it to expire, so a stolen token stops existing.
      await this.cache.delete(key);
      return null;
    }

    const now = Date.now();
    let session: SessionRecord = record;

    if (now - record.lastSeenAt > SLIDING_REFRESH_AFTER_MS) {
      // Renewed for the life it was minted with, never for the default: a short-lived curl token
      // must not turn into a ninety day one the first time it is used an hour later.
      session = { ...record, lastSeenAt: now };
      await this.cache.set(key, session, record.ttlSeconds ?? this.ttlSeconds);
    }

    return { user: this.users.toAuthenticated(owner), session, tokenHash };
  }

  /** Signs one device out. The hash is what `resolveToken` handed the guard, so no header is re-read. */
  public async revokeByHash(tokenHash: string): Promise<void> {
    if (!tokenHash) return;
    await this.cache.delete(this.sessionKey(tokenHash));
  }

  /** Signs every device of one user out, by bumping the epoch every live record is checked against. */
  public async revokeAll(userId: string): Promise<void> {
    await this.users.bumpEpoch(userId);
  }

  /**
   * Authenticates a Socket.io handshake, from either the new bag or the legacy headers.
   *
   * Called by the gateway as `resolveHandshake(socket.handshake.auth, socket.handshake.headers)`.
   * It **never throws**: a middleware that throws takes the connection down with a stack trace
   * instead of the one signal the app needs, which is a refusal it can act on.
   *
   * @returns The identity to put on `socket.data`, or `null` when the handshake is not authenticated
   */
  public async resolveHandshake(auth: unknown, headers: IncomingHttpHeaders): Promise<HandshakeIdentity | null> {
    try {
      const parsed = HandshakeAuthSchema.safeParse(auth);
      const bag = parsed.success ? parsed.data : {};

      if (bag.token) {
        const resolved = await this.resolveToken(bag.token);
        if (!resolved) return null;

        return {
          user: resolved.user,
          deviceId: bag.deviceId ?? resolved.session.deviceId,
          deviceName: bag.deviceName ?? resolved.session.deviceName,
        };
      }

      if (!this.authService.isLegacyEnabled()) return null;

      const apiKey = firstHeader(headers['x-api-key']) ?? bag.apiKey;
      const userId = firstHeader(headers['x-user-id']) ?? bag.userId;
      if (!apiKey || !userId || !this.authService.validateApiKey(apiKey)) return null;

      // The legacy client names no device, so the user agent stands in for both halves — which is
      // exactly the collision gap 5 describes, kept only for as long as the old builds are around.
      const userAgent = firstHeader(headers['user-agent']);

      return {
        user: { id: userId, legacy: true },
        deviceId: bag.deviceId ?? userAgent ?? UNKNOWN_DEVICE,
        deviceName: bag.deviceName ?? userAgent ?? UNKNOWN_DEVICE,
      };
    } catch (error: unknown) {
      this.logger.warn(`Could not resolve a socket handshake: ${getErrorMessage(error)}`);
      return null;
    }
  }

  /** The Redis key is the hash, never the token: a dump of the store hands out nothing usable. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sessionKey(tokenHash: string): string {
    return `auth:session:${tokenHash}`;
  }

  private nonceKey(nonce: string): string {
    return `auth:nonce:${nonce}`;
  }
}

/** Node gives a repeated header as an array; take the first and ignore the rest. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
