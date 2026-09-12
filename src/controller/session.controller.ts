import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthRateLimitGuard } from '../services/auth/auth-rate-limit.guard';
import { AuthSessionService } from '../services/auth/auth-session.service';
// `import type` because these appear in decorated signatures: with `isolatedModules` and
// `emitDecoratorMetadata` on, a value import of a type-only symbol there is a compile error.
import type { AuthenticatedUser, MintedSession } from '../services/auth/auth.types';
import { DEVICE_FIELD_MAX_LENGTH } from '../services/auth/auth.types';
import { CurrentUser } from '../services/auth/current-user.decorator';
import { GoogleIdTokenVerifier } from '../services/auth/google-id-token.verifier';
import { SessionAuthGuard, type AuthenticatedRequest } from '../services/auth/session-auth.guard';
import { UserService } from '../services/auth/user.service';

/**
 * The sign-in body, parsed as `unknown` because it arrives from the network.
 *
 * `deviceId` and `deviceName` carry the same cap the socket handshake applies, so a client cannot
 * write an unbounded string into every session record through either door.
 */
const SignInBodySchema = z.object({
  idToken: z.string().min(1),
  deviceId: z.string().min(1).max(DEVICE_FIELD_MAX_LENGTH),
  deviceName: z.string().min(1).max(DEVICE_FIELD_MAX_LENGTH),
});

/**
 * Google sign-in and the sessions it mints.
 *
 * A second controller on the `auth` prefix: the three provider OAuth callbacks stay in
 * `AuthController`, which is a different concern (authorising *this server* against Spotify, Qobuz
 * and YouTube) that happens to share a path segment.
 *
 * The error codes are the contract the phone reads: `401` for anything about the token, `403` —
 * naming the address — for a perfectly good Google identity that is not welcome here, so the person
 * holding the phone knows which account to switch to rather than seeing "Login failed".
 */
@Controller('auth')
export class SessionController {
  constructor(
    private readonly verifier: GoogleIdTokenVerifier,
    private readonly users: UserService,
    private readonly sessions: AuthSessionService,
  ) {}

  /**
   * A single-use nonce for the phone to pass to Credential Manager.
   *
   * It comes back inside the ID token Google signs, which is what stops a captured token being
   * replayed against a different session.
   */
  @Get('google/nonce')
  @UseGuards(AuthRateLimitGuard)
  async nonce(): Promise<{ nonce: string }> {
    return { nonce: await this.sessions.issueNonce() };
  }

  /** Verify the ID token, spend the nonce, upsert the person, mint a session. */
  @Post('google')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async signIn(@Body() body: unknown): Promise<MintedSession> {
    const parsed = SignInBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Expected { idToken, deviceId, deviceName }');
    }

    const identity = await this.verifier.verify(parsed.data.idToken);
    await this.sessions.consumeNonce(identity.nonce);

    const user = await this.users.signIn(identity);

    return this.sessions.mint(user, {
      deviceId: parsed.data.deviceId,
      deviceName: parsed.data.deviceName,
    });
  }

  /** Who the bearer belongs to. The app calls it once at startup to decide between Login and Shell. */
  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Signs this device out, by deleting the very token that authorised the call.
   *
   * The guard already parsed the bearer and left its hash on the request, so nothing here reads the
   * header again — one parser of that boundary, not two. A legacy caller leaves no hash and is
   * answered `ok` anyway: "signed out" is true of a credential that was never a session.
   */
  @Delete('session')
  @UseGuards(SessionAuthGuard)
  async signOut(@Req() request: AuthenticatedRequest): Promise<{ ok: true }> {
    if (request.sessionTokenHash) await this.sessions.revokeByHash(request.sessionTokenHash);

    return { ok: true };
  }

  /** Signs every device of this user out, by bumping the epoch each live record is checked against. */
  @Delete('sessions')
  @UseGuards(SessionAuthGuard)
  async signOutEverywhere(@CurrentUser() user: AuthenticatedUser): Promise<{ ok: true }> {
    await this.sessions.revokeAll(user.id);

    return { ok: true };
  }
}
