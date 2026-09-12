import { z } from 'zod';

/**
 * The shapes every authenticated path in the app agrees on: the REST guard, the `@CurrentUser()`
 * decorator, the socket handshake middleware and the CLI all speak these and nothing else.
 *
 * They live in their own file rather than beside the service so that a consumer — the gateway, a
 * controller — can import the type without importing the service and the Mongoose model behind it.
 */

/**
 * The most a client may say about its device, on the REST body and the socket bag alike. 128
 * characters holds a UUID and a phone model several times over; the cap is what keeps a client from
 * writing an unbounded string into every session record and `Connection` row.
 */
export const DEVICE_FIELD_MAX_LENGTH = 128;

/**
 * Who is making the call, once the request has been authenticated.
 *
 * `legacy` marks the transitional `x-api-key` + `x-user-id` pair, where the id is whatever the
 * caller asserted rather than a `User` document. It exists so a consumer can tell the two apart —
 * a legacy id is not an ObjectId and will not resolve through {@link UserService.findById}.
 */
export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
  /** true when authenticated through the transitional x-api-key + x-user-id pair */
  legacy?: boolean;
}

/**
 * What Redis holds under `auth:session:<sha256hex(token)>`.
 *
 * `epoch` is the owner's `sessionEpoch` at minting time; a session minted under an older epoch is
 * refused, which is how "sign out everywhere" and "block this person" are one `$inc` rather than an
 * enumeration of a user's sessions.
 *
 * `ttlSeconds` is the lifetime the session was minted with, so the sliding refresh renews it for
 * that long and not for the server default: a two hour token minted for curl stays a two hour
 * token. Optional because records written before the field existed carry none; those slide on the
 * default.
 *
 * A schema rather than an interface, and the type derived from it, because the record comes back
 * out of Redis — where a previous deploy wrote it — and is parsed on the way out like any other
 * boundary. One declaration means a field cannot exist in the type and be stripped by the parse.
 */
export const SessionRecordSchema = z.object({
  userId: z.string().min(1),
  epoch: z.number(),
  deviceId: z.string(),
  deviceName: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  ttlSeconds: z.number().positive().optional(),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/**
 * A bearer token resolved to its owner. `tokenHash` is the Redis key: the guard carries it on the
 * request so `DELETE /auth/session` revokes exactly the token that authorised the call, without
 * parsing the header a second time.
 */
export interface ResolvedSession {
  user: AuthenticatedUser;
  session: SessionRecord;
  tokenHash: string;
}

/** What the socket gateway puts on `socket.data` once a handshake has been accepted. */
export interface HandshakeIdentity {
  user: AuthenticatedUser;
  deviceId: string;
  deviceName: string;
}

/** The answer to a successful sign-in. `expiresAt` is epoch milliseconds. */
export interface MintedSession {
  token: string;
  expiresAt: number;
  user: AuthenticatedUser;
}
