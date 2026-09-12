# Auth and login: Google sign-in, sessions, and the credential store

An implementation plan. It covers the NestJS server (this repo) and the Android app
(`domotic-giraffe`), in the order the work has to land so that nothing breaks a phone that is
already in use. It was written against `dj-nounoune` v0.33.0 on the `next` branch and the Android
app at commit `935c851`.

## 1. Where we stand

**One shared key, one hard-coded user.** `AUTHX_API_KEY` is the only credential the server knows.
`ApiAuthGuard` checks it on `/chatroom/*`, `ChatGateway.handleConnection` checks it on the socket
handshake, and both then *believe* whatever `x-user-id` the caller sends. The app bakes the key into
the APK (`BuildConfig.API_KEY`, read from `local.properties`) and sends `x-user-id:
Alexis-le-Trotteur` from two places (`NetworkModule.authInterceptor`,
`SocketIoChatRepositoryImpl.openSocket`), plus the same literal in the `POST /chatroom` body.
`FakeAuthRepositoryImpl` flips a boolean after a one second delay; the "Sign in with Google"
button is a prop.

**The three streaming providers keep their tokens in dotfiles.** `.spotify-session.json`,
`.qobuz-session.json` and `.youtube-session.json` sit at `process.cwd()`, written by the CLI
`auth` subcommands and rewritten by the Spotify and YouTube refresh loops. They are gitignored and
kept out of the image, which is the only protection they have.

**`/vibing-on` is open by design** and stays that way. Nothing in this plan touches
`VibingController`, `VibingGateway` or the `/vibing` namespace.

### The gaps, ranked

| # | Gap | Where | Severity | Closed in |
|---|---|---|---|---|
| 1 | Caller-asserted identity. `x-user-id` and the `userId` in the `POST /chatroom` body are taken on faith, so any holder of the key can read, create and delete another user's chats by changing a header. | `api-auth.guard.ts:16`, `chat.controller.ts:41`, `chat.gateway.ts:118` | High | Phase 1 |
| 2 | No ownership check on a chat once its id is known: `GET /chatroom/:id`, `/history`, `/messages`, `DELETE /chatroom/:id`, and the socket frames `chat:resync`, `chat:refresh`, `chat:send`, `chat:action` all resolve the chat by id alone. | `chat.service.ts` (`findOne`, `remove`, `getHistory`), `chat-stream.service.ts:368`, `chat.gateway.ts:174` | High | Phase 1 |
| 3 | `GET /chatroom` with no `x-user-id` lists every conversation on the server. | `chat.controller.ts:36` | High | Phase 1 |
| 4 | One key for every device, baked into every APK ever built, with no way to revoke a single phone short of rotating it everywhere. | `NetworkModule.kt`, `local.properties` | High | Phase 3 |
| 5 | A socket session is resumed by `userId` + `User-Agent`. Two phones with the same UA string (every build of the app sends `DomoticGiraffe/1.0 (Android)`) share one `Connection` document and the second silently takes over the first's room. | `session.service.ts:47` | Medium | Phase 1 |
| 6 | Provider refresh tokens in plaintext files, addressed relative to `cwd`. In the image `/usr/src/app` is root-owned and the process runs as `node`, so a refresh cannot be written back unless the file is bind-mounted writable; for YouTube the write happens *before* the in-memory session is replaced (`youtube-auth.util.ts:230`), so a failed write leaves the old token in memory and the one-minute loop failing until restart. Verify against the compose file, which is not in this repo. | `spotify.service.ts:184`, `youtube-auth.util.ts:230`, `Dockerfile` | Medium | Phase 4 |
| 7 | The OAuth callback pages interpolate the `code` query parameter into HTML and into a `<span>` unescaped: a reflected XSS on an unauthenticated route. The provider flows also send a constant `state` (`'state'`) and never check it. Low impact today because the code is pasted into a terminal by hand, not consumed by the callback. | `auth.controller.ts:44`, `spotify-auth.util.ts:15`, `youtube-auth.util.ts:69` | Low | Housekeeping (escape now); `state` deferred with Phase 5 |
| 8 | Debug builds log every request at `HttpLoggingInterceptor.Level.BODY`, headers included, so the key lands in logcat. `crash.txt` and `logcat.txt` are tracked in the app's git history (checked: neither contains the key or the header today). Three 780 MB heap dumps sit at the repo root (gitignored, but a heap dump holds the key in memory). | `NetworkModule.kt:44`, app repo root | Medium | Housekeeping |
| 9 | `android:allowBackup="true"` with every SharedPreferences file included in backup and device transfer. Harmless today; the moment a session token is stored, it is backed up to Google. | `AndroidManifest.xml`, `backup_rules.xml`, `data_extraction_rules.xml` | Low | Phase 2 |
| 10 | Two of the three servers are cleartext (`http://192.168.2.10:3000`, `http://192.168.2.13:3000`, `usesCleartextTraffic="true"`). A bearer token over HTTP on the LAN is readable by anyone on the LAN. The `.lan` server already has TLS with a pinned private CA. | `AppServer.kt`, `network_security_config.xml` | Medium | Accepted for dev servers, see §9 |
| 11 | No rate limit anywhere. Irrelevant for a shared key; relevant the day there is a sign-in endpoint that accepts tokens from the network. | `main.ts` | Low | Phase 1 |
| 12 | `cors: true` on both gateways. Meaningless for a native app; would matter for a browser client. | `chat.gateway.ts:54` | Low | Leave, note in docs |
| 13 | `AuthService` throws at construction without `AUTHX_API_KEY`, which means the CLI needs the key too, for an HTTP check it never performs. | `auth.service.ts:17` | Low | Phase 1 |

## 2. Target design

### 2.1 Identity

The Google account is the identity and the **email is the login**. There is no password, no account
creation and no profile form on the app side. The server holds one `User` document per person,
created on their first successful sign-in and keyed on Google's stable `sub` claim, with the email
beside it because that is what humans and the allow-list use.

**Who may sign in** is an allow-list, `AUTH_ALLOWED_EMAILS`, comma separated, case-insensitive.
Without it, anybody with a Google account and a route to the server could create a user and drive
the house's MPD. A `User` can additionally be `blocked` from the CLI, which wins over the list. The
list lives in the environment rather than in Mongo because the household changes once a year and
an invitation UI is not worth building for that; moving it to Mongo later is a one-service change
(§9).

### 2.2 The sign-in flow

```
phone                                   server                                  Google
  |                                        |                                       |
  |  GET /auth/google/nonce                |                                       |
  |<-- { nonce } ------------------------- |  auth:nonce:<nonce> in Redis, 5 min   |
  |                                        |                                       |
  |  Credential Manager: GetSignInWithGoogleOption(serverClientId, nonce)          |
  |  ------------------------------------------------------------------------------>|
  |<-- GoogleIdTokenCredential (ID token JWT, aud = web client id, nonce claim) ----|
  |                                        |                                       |
  |  POST /auth/google                     |                                       |
  |  { idToken, deviceId, deviceName }     |  verify signature (JWKS), iss, aud,   |
  |                                        |  exp, email_verified, nonce (single   |
  |                                        |  use), allow-list, User.status        |
  |                                        |  upsert User; mint session            |
  |<-- { token, expiresAt, user } -------- |  auth:session:<sha256(token)>, 90 d   |
  |                                        |                                       |
  |  Authorization: Bearer <token>   (REST)                                        |
  |  auth: { token, deviceId, deviceName } (socket handshake)                      |
```

What the server verifies on the ID token, and nothing less:

- the signature, against Google's JWKS at `https://www.googleapis.com/oauth2/v3/certs`;
- `iss` is `https://accounts.google.com` or `accounts.google.com`;
- `aud` equals `GOOGLE_SIGNIN_CLIENT_ID`, the **Web** client id (§6);
- `exp` and `iat`, with a minute of clock skew;
- `email_verified` is `true`;
- `nonce` matches one the server issued in the last five minutes, and is deleted on use.

The nonce is what stops a captured ID token from being replayed against a different session, and
it is the first of the things this plan keeps in Redis rather than trusting the client with. The
verifier is `jose` (`createRemoteJWKSet` + `jwtVerify`): zero dependencies, no install script,
handles key rotation and `kid` lookup, and refuses `alg: none`. `google-auth-library` does the
same job and drags in a dozen packages; hand-rolling with `node:crypto` is where alg-confusion bugs
live. Run `npm run security:check` after adding it.

### 2.3 Sessions

An app session is an **opaque bearer token**, not a JWT: 32 random bytes, base64url. The server
stores its SHA-256 as the key, so a Redis dump does not hand out live tokens.

```
auth:session:<sha256(token)>  ->  { userId, epoch, deviceId, deviceName, createdAt, lastSeenAt }
                                  TTL AUTH_SESSION_TTL_DAYS (default 90), sliding
```

- **Sliding**, refreshed at most once an hour on use, so a phone that is used stays signed in and
  one that is not falls off after three months.
- **Revocable per device** (`DELETE /auth/session` deletes the key) and **per user**: `User`
  carries a `sessionEpoch`; a session minted under an older epoch is refused. "Sign out everywhere"
  and "block this person" are both one `$inc`, with no need to enumerate a user's sessions, which
  is why the design needs no Redis sets.
- **In Redis, not Mongo**, for the same reason the queue projection is: it is looked up on every
  request and every handshake, it wants a native TTL, and Redis is already required to boot. The
  cost is that a Redis restart without persistence signs every phone out, which on a household
  server is one tap each. If that ever matters, the same service over a Mongo collection with a
  TTL index is a drop-in (§9).

`AuthSessionService` resolves a token to `{ user: { id, email, name, picture }, session }`, caching
`User` reads for sixty seconds in memory so a block takes effect within a minute without a Mongo
read per request.

### 2.4 `users`

```ts
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, description: 'Google account id (`sub` claim), the stable identity' })
  googleSub: string;

  @Prop({ required: true, unique: true, lowercase: true, description: 'Google account email, the login and what the allow-list matches' })
  email: string;

  @Prop({ description: 'Display name as Google reports it' })
  name?: string;

  @Prop({ description: 'Avatar url as Google reports it' })
  picture?: string;

  @Prop({ required: true, default: 'active', description: 'active | blocked; blocked wins over the allow-list' })
  status: 'active' | 'blocked';

  @Prop({ required: true, default: 0, description: 'Bumped to invalidate every session minted before it' })
  sessionEpoch: number;

  @Prop({ description: 'Last successful sign-in' })
  lastLoginAt?: Date;
}
```

`Chat.userId` becomes the `User._id` string. Not the email (it appears in logs and can change) and
not the Google `sub` (opaque enough, but then two collections would carry Google's key). The
existing chats belong to `Alexis-le-Trotteur`; a CLI command reassigns them (§3.5).

### 2.5 What changes on the wire

| Today | After |
|---|---|
| `x-api-key: <shared>` on REST | `Authorization: Bearer <session token>` |
| `x-user-id: <anything>` on REST | dropped; the user is the session's |
| `POST /chatroom { topic, userId }` | `POST /chatroom { topic }` |
| `GET /chatroom` → everything, or one user's when the header is sent | always the caller's |
| `GET /chatroom/:id`, `/history`, `/messages`, `DELETE` → by id | by id **and** owner; `404` otherwise, so ids do not leak existence |
| socket `extraHeaders: x-api-key, x-user-id` | socket `auth: { token, deviceId, deviceName }` |
| unauthorised socket → silent `disconnect()` | `connect_error` with `unauthorized`, so the app can tell a dead session from a dead server and go back to the login screen instead of retrying forever |
| — | `GET /auth/google/nonce`, `POST /auth/google`, `GET /auth/me`, `DELETE /auth/session`, `DELETE /auth/sessions` |

Session-scoped envelopes (the transport bar, MPD's queue) stay global: the daemon holds one queue
and any signed-in member may drive it, the same stance `/vibing-on` takes for the whole LAN. The
ownership rule is about **conversations**, which are personal.

### 2.6 Ownership, enforced at the query

Every chat read or write takes the caller's `userId` and filters on it in Mongo: `findOne({ _id,
userId })`, `findOneAndDelete({ _id, userId })`. No separate "may this user see this chat" step that
a new route can forget. The gateway's `accept()` gains the same check for any frame that names a
`chatId`, and `chat:action` resolves its `messageId` to an envelope, the envelope to a chat, and
checks that; an action with no chat (a transport button) is allowed for any signed-in user.

### 2.7 The provider credential store

The Spotify, Qobuz and YouTube sessions move to a `provider_credentials` collection, one document
per provider, **encrypted at rest** with AES-256-GCM under `CREDENTIAL_ENCRYPTION_KEY` (32 bytes,
base64; `openssl rand -base64 32`).

```ts
@Schema({ timestamps: true })
export class ProviderCredential {
  @Prop({ required: true, unique: true, description: 'spotify | qobuz | youtube' })
  provider: string;

  @Prop({ required: true, description: 'First 8 hex of sha256 of the key that encrypted this row, to notice a rotation' })
  keyId: string;

  @Prop({ required: true }) iv: string;         // 12 bytes, base64
  @Prop({ required: true }) ciphertext: string; // base64
  @Prop({ required: true }) authTag: string;    // base64

  @Prop({ description: 'Email of the person who ran the auth flow, or "cli"' })
  updatedBy?: string;
}
```

`CredentialStoreService` (`src/services/credential-store/`) exposes `load<T>(provider, schema:
ZodType<T>)`, `save(provider, value)` and `clear(provider)`. The value is JSON inside the
ciphertext, parsed by the caller's own Zod schema on the way out, exactly as the dotfiles are today,
so `SpotifySessionSchema`, `QobuzSessionSchema` and `YoutubeSessionSchema` carry over unchanged.
Without the key the store logs one warning at boot and every `load` answers `null`: the provider
features stay off rather than the app crashing, which is the posture every optional section of
`.env.template` already takes.

**Mongo, not Redis, for these**, deliberately. They are the only copy of refresh tokens that took a
human in the loop to obtain, and for Qobuz that loop involves Wireshark. `promptus clear-cache` and
`RedisCacheService.deleteByPattern('*')` would take them with it. Redis holds what can be re-minted
by tapping a button; Mongo holds what cannot.

Two consequences inside the services:

- `SpotifyService.onModuleInit` reads the file synchronously today; it becomes `async` (Nest awaits
  it) and reads the store. `QobuzService.login` and `YoutubeService.onModuleInit` follow.
- A running server does not notice a re-auth done from the CLI. Today that is "restart the server";
  it stays that, plus one cheap improvement: on the first `401` from a provider, reload from the
  store once before giving up.

### 2.8 OAuth `state` and `nonce`, in Redis

Every short-lived secret the server issues to a client goes into Redis with a TTL and is deleted on
use, never trusted from the client:

| Key | Issued by | TTL | Consumed by |
|---|---|---|---|
| `auth:nonce:<nonce>` | `GET /auth/google/nonce` | 5 min | `POST /auth/google` |
| `auth:ratelimit:<ip>` | any `/auth/*` call | 1 min | the same guard (`increment`, cap 20) |
| `auth:oauth-state:<state>` | `GET /auth/<provider>/start` (Phase 5, deferred) | 10 min | `GET /auth/<provider>/callback` |

`RedisCacheService` already has `set` with TTL, `delete` and `increment` with TTL-on-create; nothing
new is needed on that side.

### 2.9 What stays open

`GET /vibing-on`, `/vibing-on/now-playing`, `/vibing-on/weather`, `/vibing-on/artwork/:songId`, the
`/vibing` namespace including `vibing-control` and `vibing-reaction`, and the three OAuth callback
pages. `VibingGateway`'s header comment already says why, and this plan does not argue with it.

### 2.10 Configuration

```
# added
GOOGLE_SIGNIN_CLIENT_ID=      # the Web OAuth client id; audience of every ID token (§6)
AUTH_ALLOWED_EMAILS=          # comma separated; empty means nobody can sign in
AUTH_SESSION_TTL_DAYS=        # default 90
CREDENTIAL_ENCRYPTION_KEY=    # base64, 32 bytes; provider tokens are unreadable without it

# transition only, then deleted
AUTHX_API_KEY=                # while set, the legacy x-api-key path is still accepted
AUTHX_API_KEY_ENABLED=        # true switches that path on for the rollout; unset means off (breaking: set it, or the old build is locked out)
```

No Google client secret is needed for sign-in; ID token verification needs only the audience.
`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` stay what they are, for the YouTube Data API code
exchange.

## 3. Server work

### 3.1 New

| File | Holds |
|---|---|
| `src/schemas/user.schema.ts` | §2.4 |
| `src/schemas/provider-credential.schema.ts` | §2.7 |
| `src/services/auth/google-id-token.verifier.ts` | `jose` JWKS + `jwtVerify`; a Zod schema over the claims (`sub`, `email`, `email_verified`, `name`, `picture`, `nonce`, `hd`); returns a typed `GoogleIdentity` |
| `src/services/auth/user.service.ts` | allow-list check, upsert on sign-in (by `sub`, falling back to `email` and re-pointing `sub` when an account was re-created), `block`/`unblock`, `bumpEpoch`, a sixty second read cache |
| `src/services/auth/auth-session.service.ts` | mint, resolve (token → user + session, epoch check, sliding refresh), revoke one, revoke all; nonce issue/consume |
| `src/services/auth/session-auth.guard.ts` | replaces `ApiAuthGuard`; reads `Authorization: Bearer`; while `AUTHX_API_KEY` is set also accepts the legacy pair; sets `request.user` |
| `src/services/auth/current-user.decorator.ts` | `@CurrentUser()` param decorator over `request.user` |
| `src/services/auth/auth-rate-limit.guard.ts` | `increment('auth:ratelimit:<ip>', 60)`, `429` past 20 |
| `src/services/auth/socket-auth.middleware.ts` | `server.use(...)` in `ChatGateway.afterInit`: resolves `handshake.auth.token`, puts `{ user, deviceId, deviceName }` on `socket.data`, `next(new Error('unauthorized'))` otherwise |
| `src/controller/session.controller.ts` | `@Controller('auth')`: `GET google/nonce`, `POST google`, `GET me`, `DELETE session`, `DELETE sessions`. The provider callbacks stay in `auth.controller.ts`; two controllers may share a prefix |
| `src/services/credential-store/credential-store.service.ts` + module | §2.7 |
| `src/cli/auth/*` | §3.5 |

### 3.2 Changed

- `auth.service.ts`: the key becomes optional; `validateApiKey` returns `false` when none is
  configured. Fixes gap 13 on the way.
- `chat.controller.ts`: `@UseGuards(SessionAuthGuard)`; every handler takes `@CurrentUser()` and
  passes `user.id` down; `createChatroom` body loses `userId`; `getMessages` checks ownership
  before calling `backlog`.
- `chat.service.ts`: `findOne(id, userId)`, `remove(id, userId)`, `getHistory(id, userId)`,
  `assertOwned(id, userId)`; `summaries(userId)` required; `findAll` goes (the CLI has Mongo).
- `chat.gateway.ts`: `afterInit` installs the middleware; `handleConnection` reads `socket.data`
  instead of headers; `accept()` checks `chatId` ownership; `handleAction` resolves the envelope's
  chat. The `credential()` helper and the header path go with the legacy key.
- `session.service.ts`: `retrieveUserSession(userId, deviceId, client)` matches on `deviceId`, not
  `deviceName`; `createSession` stores both. `deviceName` stays for the log line. The
  `Connection` schema gains `deviceId` with a description.
- `chat-action.service.ts`: `execute(request, userId)`; `declaredActions` already loads the
  envelope, so the owner check is one more line there.
- `spotify.service.ts`, `spotify-auth.util.ts`, `qobuz.service.ts`, `qobuz-auth.util.ts`,
  `youtube.service.ts`, `youtube-auth.util.ts`: every `fs` call becomes a `CredentialStoreService`
  call; the `path`/`fs` imports go.
- `auth.controller.ts`: escape the code before rendering, or put it in a `data-` attribute and let
  the script read `dataset`, which is the smaller change.
- `app.module.ts`: `User` and `ProviderCredential` models, the new providers and controller,
  `CredentialStoreModule`.
- `.env.template`, `README.md` (HTTP and WebSocket API, the auth callbacks, the "session lands in
  `.x-session.json`" sentences), `CLAUDE.md` ("Chat request flow", "Known drift"), `.gitignore`
  and `.dockerignore` (drop the three dotfile entries once Phase 4 lands).

### 3.3 The sign-in handler

```ts
@Post('google')
@UseGuards(AuthRateLimitGuard)
async signIn(@Body() body: unknown): Promise<SignInResponse> {
  const { idToken, deviceId, deviceName } = SignInBodySchema.parse(body);   // Zod at the boundary
  const identity = await this.verifier.verify(idToken);                     // throws → 401
  await this.sessions.consumeNonce(identity.nonce);                         // missing/used → 401
  const user = await this.users.signIn(identity);                           // not allowed/blocked → 403
  return this.sessions.mint(user, { deviceId, deviceName });                // { token, expiresAt, user }
}
```

Errors are `UnauthorizedException` for anything about the token and `ForbiddenException` for a
verified identity that is not welcome, and the `403` body names the email so the person on the
phone knows which account to switch to.

### 3.4 The socket middleware

```ts
afterInit(server: Server): void {
  server.use(async (socket, next) => {
    const resolved = await this.sessionAuth.resolveHandshake(socket.handshake.auth);   // Zod over the bag
    if (!resolved) return next(new Error('unauthorized'));
    socket.data = { ...resolved };            // { user, deviceId, deviceName }
    next();
  });
}
```

A middleware rather than a check in `handleConnection` because it can *refuse* with a reason: the
Android client receives `connect_error` with `unauthorized` in `args`, which is the one signal that
must not be retried. `handleConnection` becomes purely about sessions and rooms.

### 3.5 CLI

`src/cli/auth/auth.command.ts` with subcommands, registered in `command.provider.ts`:

```
npm run cli -- auth users                                  # email, status, last login, chat count
npm run cli -- auth block <email> | unblock <email>
npm run cli -- auth revoke <email>                         # bump sessionEpoch: signed out everywhere
npm run cli -- auth claim --from <legacyUserId> --email <email> [--dry-run]
                                                           # re-point Chat.userId; the user must have signed in once
npm run cli -- auth session --email <email> [--ttl 2h]     # mint a bearer for curl; replaces the shared key for debugging
npm run cli -- auth import-sessions [--delete]             # the three dotfiles → provider_credentials
```

The CLI boots the same module, so Mongo is there; Redis connects lazily on the first `set`, so
`auth session` works despite the boot probe being skipped under `IS_CLI`.

## 4. Android work (`domotic-giraffe`)

### 4.1 Dependencies

`gradle/libs.versions.toml`:

```toml
credentials = "1.3.0"
googleid = "1.1.1"

androidx-credentials = { group = "androidx.credentials", name = "credentials", version.ref = "credentials" }
androidx-credentials-play-services = { group = "androidx.credentials", name = "credentials-play-services-auth", version.ref = "credentials" }
googleid = { group = "com.google.android.libraries.identity.googleid", name = "googleid", version.ref = "googleid" }
```

These versions build against `compileSdk 34` and Kotlin 1.9.24; the 1.5.x line of Credential
Manager wants `compileSdk 35`, which is a separate upgrade. Google Play services on the phone is a
hard requirement of the Google ID flow.

`app/build.gradle.kts`: `API_KEY` goes, `GOOGLE_WEB_CLIENT_ID` comes (`buildConfigField`, read
from `local.properties` like `BASE_URL`; it is not a secret, it is an audience).

### 4.2 New

| File | Holds |
|---|---|
| `data/auth/GoogleSignInClient.kt` | wraps `CredentialManager`: `signIn(activity, nonce): String` (the ID token) via `GetSignInWithGoogleOption.Builder(webClientId).setNonce(nonce)`, and `clear()` via `clearCredentialState`. Needs an **Activity** context, so the screen passes `LocalContext.current` to the view model call rather than the view model holding one |
| `data/auth/DeviceIdentity.kt` | a UUID minted once into private prefs, and `Build.MODEL` as the name. Replaces the UA as the device key (gap 5) |
| `data/local/AuthSessionStore.kt` | token + user in `auth_session.xml`, `MODE_PRIVATE`, exposed as `StateFlow<AuthSession?>`. Excluded from backup (below). The app sandbox is the protection Google's own tokens rely on; wrapping the token with an Android Keystore key is optional hardening, not a prerequisite |
| `data/remote/AuthApiService.kt` + DTOs | `GET auth/google/nonce`, `POST auth/google`, `GET auth/me`, `DELETE auth/session` |
| `data/repository/GoogleAuthRepositoryImpl.kt` | replaces `FakeAuthRepositoryImpl`: nonce → Credential Manager → `POST /auth/google` → store; `signOut` = server `DELETE` (best effort) + store clear + `clearCredentialState` |
| `domain/model/UserAccount.kt` | id, email, name, picture |

### 4.3 Changed

- `domain/repository/AuthRepository.kt`: `suspend fun signIn(activity: Activity): Result<Unit>`,
  `suspend fun signOut()`, `val session: StateFlow<AuthSession?>`.
- `di/RepositoryModule.kt`: bind the Google implementation.
- `di/NetworkModule.kt`: the auth interceptor reads the store per request and sets
  `Authorization: Bearer`; `x-api-key` and `x-user-id` go; `loggingInterceptor.redactHeader("Authorization")`;
  a response interceptor that clears the store on `401` so the UI drops to Login.
- `SocketIoChatRepositoryImpl.kt`: `options.auth = mapOf("token" to ..., "deviceId" to ...,
  "deviceName" to ...)` instead of `extraHeaders`; the socket is opened when a session exists and
  closed on sign-out, not in `init`; `EVENT_CONNECT_ERROR` with `unauthorized` clears the store
  instead of letting socket.io retry. `reconnect()` already tears everything down and is the
  sign-out path's second half. `createNewSession` drops `userId` from the body.
- `LoginViewModel.kt` / `LoginScreen.kt`: the button calls `signIn(activity)`; `Error` shows the
  server's `403` text when it is one, since "this Google account is not on the list" is an answer
  and "Login failed" is not.
- `NavGraph.kt`: start destination is `Shell` when the store holds a session, `Login` otherwise;
  a cleared store navigates to `Login` with `popUpTo(0)`.
- `AppHeader.kt`: `Avatar` takes the account's `picture` (Coil is already there) and initials as
  the fallback; the "placeholder until there is a real identity" comment retires.
- `SettingsScreen.kt` / `SettingsViewModel.kt`: an ACCOUNT group with the email and a Sign out
  row.
- `res/xml/backup_rules.xml` and `data_extraction_rules.xml`: `<exclude domain="sharedpref"
  path="auth_session.xml"/>` in every section.
- `local.properties`: `API_KEY` removed, `GOOGLE_WEB_CLIENT_ID` added.

## 5. Housekeeping, independent of the phases

- Escape the code in `AuthController.renderAuthCodePage` (gap 7). Ten minutes, do it first.
- In the app repo: `git rm --cached crash.txt logcat.txt`, add both to `.gitignore`, delete the
  three `.hprof` files (2.3 GB, and process memory). Gap 8.
- `redactHeader` on the logging interceptor now, for the key, before it is for the token.
- Rotate nothing: at cutover `AUTHX_API_KEY` is deleted, not rotated. It has been in every APK.

## 6. Google Cloud: registering the app

Everything happens in one Cloud project. Reuse the one that holds `YOUTUBE_CLIENT_ID`, so the
household signs in and authorises YouTube under one consent screen. Nothing here costs anything
and no API has to be enabled: Sign in with Google through Credential Manager is an identity
service, not an API product.

### 6.1 The consent screen (Google Auth Platform)

1. Open https://console.cloud.google.com/auth/overview with the project selected. A project that
   never configured a consent screen shows **Get started**; one that did (this one, for the
   YouTube client) shows the Overview and the pages below.
2. **Branding**: app name (what the phone shows on the sheet, e.g. `Domotic Giraffe`), user
   support email, developer contact email. Logo and domains are optional and stay empty.
3. **Audience**: user type **External** (Internal needs a Workspace organisation). Publishing
   status **Testing**, and under *Test users* add every Google account of the household. Only
   listed accounts can sign in while the app is in Testing, which is a second allow-list on top
   of `AUTH_ALLOWED_EMAILS`; the cap is 100.
4. **Data Access**: *Add or remove scopes*, tick `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`, then *Update* and *Save*. All three are non-sensitive, so no
   verification is ever asked for them.

A note on Testing: the same consent screen governs the YouTube OAuth client, and Google expires
refresh tokens issued by an External app in Testing after seven days. If `youtube liked` needs a
re-auth every week, that is why. *Publish app* on the Audience page lifts it; the
`youtube.readonly` scope is sensitive, so an unverified published app shows a warning screen on
the YouTube consent that the household clicks through, while the sign-in scopes show nothing.

### 6.2 The Android client, one per signing key

Google Play services hands an ID token only to an app whose package name and signing certificate
are registered. The debug keystore is per machine, so a second development PC needs its own
client.

1. The SHA-1, from the app repo:
   ```powershell
   Set-Location C:\Workspaces\domotic-giraffe; .\gradlew signingReport
   ```
   Read `SHA1:` under `Variant: debug`. The same report lists the release key once
   `buildTypes.release` has a `signingConfig`; today it has none, so there is no release client to
   create yet. Without Gradle, `keytool` from Android Studio's JDK reads the same keystore:
   ```powershell
   & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
   ```
2. **Clients** → **Create client** → Application type **Android**. Name it after the key
   (`Domotic Giraffe debug — <machine>`), package name `com.example.domoticgiraffe`, paste the
   SHA-1, **Create**.
3. Nothing from this client goes into code or config. It has no secret and its id is never sent
   anywhere; it exists so the phone's Play services will vouch for the app.

The console normally accepts a `com.example` package name (it is Play that refuses it). If it
objects, `applicationId` in `app/build.gradle.kts` is the one line to change, plus the package the
Hilt classes live in.

### 6.3 The Web client, the audience

1. **Clients** → **Create client** → Application type **Web application**. Name it for what it is
   (`dj-nounoune sign-in audience`). Leave *Authorised JavaScript origins* and *Authorised
   redirect URIs* empty: no browser and no redirect is involved in this flow.
2. **Create**, then copy the **Client ID** (ends in `.apps.googleusercontent.com`). Do not download
   the JSON and do not copy the secret: ID token verification needs only the id.
3. The same id goes to both sides, and both must come from the same project as the Android
   client:
   - server, `.env`: `GOOGLE_SIGNIN_CLIENT_ID=<id>`
   - app, `local.properties`: `GOOGLE_WEB_CLIENT_ID=<id>`

The Android client and the Web client together are what `GetSignInWithGoogleOption(serverClientId)`
needs: the first proves the app, the second names who the token is for.

### 6.4 What goes wrong, and what it means

| Symptom | Cause |
|---|---|
| "Access blocked: Domotic Giraffe has not completed the Google verification process", `access_denied` | The account is not in the Test users list while the app is in Testing |
| Credential Manager throws `NoCredentialException` ("no credentials available") with an account signed in on the phone | Package name or SHA-1 match no Android client in the project, or the client was created minutes ago and has not propagated yet (allow up to an hour) |
| "[28444] Developer console is not set up correctly", and the Play services logcat shows `FetchGoogleIdTokenCredentialOperation` succeeding then `CompleteSignInOperation` failing | The id in `GOOGLE_WEB_CLIENT_ID` is a **Desktop app** ("installed") or Android client, not a Web application client. The package, SHA-1, project and test user are usually fine. Create a Web application client and put its id on both sides; the downloaded JSON of a Desktop client says `"installed"` at the top, a Web one says `"web"` |
| Server answers `401` with an audience error | The app's `GOOGLE_WEB_CLIENT_ID` and the server's `GOOGLE_SIGNIN_CLIENT_ID` differ, or one of them is the Android client's id rather than the Web client's |
| Server answers `403` | Signed in fine, but the email is not in `AUTH_ALLOWED_EMAILS`, or the user is blocked |

## 7. Rollout

Ordered so the phone in daily use never stops working between steps.

### Phase 0 — prerequisites (half a day)

§6, plus `CREDENTIAL_ENCRYPTION_KEY` and `AUTH_ALLOWED_EMAILS` in `.env`. Housekeeping from §5.

### Phase 1 — server: ownership, then the new path beside the old (2–3 days)

1. Ownership in `ChatService`, the controller and the gateway (§2.6). This is a bug fix whatever
   the identity source; during this phase the user id still comes from `x-user-id`.
2. `User`, verifier, `AuthSessionService`, `SessionController`, `SessionAuthGuard` accepting
   **both** `Authorization: Bearer` and, while `AUTHX_API_KEY` is set and `AUTHX_API_KEY_ENABLED=true`, the legacy pair.
3. Socket middleware accepting both `handshake.auth.token` and the legacy headers; `deviceId` from
   the bag, UA as the fallback.
4. `auth` CLI: `users`, `session`, `revoke`, `claim`.

Acceptance, with the server running:

```bash
# legacy still works
curl -s http://localhost:3000/chatroom -H "x-api-key: $AUTHX_API_KEY" -H "x-user-id: Alexis-le-Trotteur"
```
```bash
# a chat id from that list, under another user id: must be 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/chatroom/<id>/messages -H "x-api-key: $AUTHX_API_KEY" -H "x-user-id: someone-else"
```
```bash
# a minted session over the new path
npm run cli -- auth session --email alexandre.tremblay.it@gmail.com --ttl 2h
```
```bash
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer <token>"
```
```bash
# a bad token, 21 times: the 21st must be 429
for i in $(seq 1 21); do curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:3000/auth/google -H 'Content-Type: application/json' -d '{"idToken":"x","deviceId":"d","deviceName":"n"}'; done; echo
```

`npm run build` clean; `npm run security:check` after `jose`.

### Phase 2 — app: real sign-in (2–3 days)

§4. Sideload; both credential paths are live on the server, so an old build keeps working on the
same box. Acceptance: fresh install → Sign in with Google → chats listed are only this account's
→ `auth claim` from the CLI brings the old conversations across → Settings shows the email → Sign
out → the socket closes, the app sits on Login → `auth revoke` from the CLI while signed in → the
next request drops the app to Login within a minute. An account not on the list gets the `403`
text on the login screen.

### Phase 3 — cutover (half a day)

1. Delete `AUTHX_API_KEY_ENABLED=true` from `.env` (the key may stay for a rollback: putting the flag back re-opens the path);
   restart. Later, the legacy branch in the guard and the middleware, the
   `credential()` helper, `AuthService.validateApiKey` and the header reading in the app are
   deleted, not flagged off.
2. `README.md`, `CLAUDE.md`, `.env.template` updated.
3. `API_KEY` removed from `local.properties`; a release build with no key in it.

### Phase 4 — provider credentials to Mongo (1–2 days)

1. `ProviderCredential`, `CredentialStoreService`, the six provider files (§3.2).
2. `npm run cli -- auth import-sessions --delete` on the box; verify `spotify list`, `qobuz
   favorites`, `youtube liked` still answer; watch one Spotify refresh land in Mongo (`updatedAt`
   moves) rather than on disk.
3. Drop the dotfile entries from `.gitignore` and `.dockerignore`; remove the "Known drift" line in
   `CLAUDE.md`.

Independent of Phases 1–3 and could go first; it is last because it touches the thing that plays
music, and a wrong step there is noticed at dinner.

### Phase 5 — deferred: provider re-auth from the browser (1–2 days)

Not now, by decision (§9). Kept so the `state` key in §2.8 has a home when it comes back.

`GET /auth/<provider>/start` behind the session guard and a `role: admin` on `User`, which writes
`auth:oauth-state:<state>` and redirects; the callback verifies the state, exchanges the code
server-side and stores the result, so nobody pastes codes into a terminal again. This is where a
real `state` finally earns its place, and where gap 7 closes completely rather than being escaped
around.

## 8. Documentation to touch

- `CLAUDE.md`: the "Chat request flow" paragraph (`x-api-key` + `x-user-id`, "No real auth — shared
  key only") becomes a paragraph on sessions; "Known drift" loses the dotfiles; a short "Auth"
  section pointing here.
- `README.md`: the `AUTHX_API_KEY` row, "HTTP and WebSocket API", the three "session lands in"
  sentences, the security section that lists the dotfiles.
- `.env.template`: an AUTH section (§2.10); the provider sections stop naming files.

## 9. Decisions taken

Settled on 2026-09-12. What each one changes in the plan above.

1. **Allow-list in the environment.** `AUTH_ALLOWED_EMAILS` in `.env`, one list per server: the
   dev boxes and the production box each carry their own. No `auth allow` CLI, no invitation UI.
2. **Sessions in Redis, with a long TTL.** `AUTH_SESSION_TTL_DAYS` defaults to 90, sliding, so a
   phone that is used never signs out and one left in a drawer does after a season. The provider
   credentials are unaffected: they stay in Mongo with no expiry at all (§2.7).
3. **Cleartext servers stay usable for sign-in.** `Supa-Mint` and `Supa-Two` are development
   boxes reached over plain HTTP; the `.lan` server is production and has TLS. The app attaches
   the bearer token on either, so on the dev boxes it crosses the LAN in the clear, which is
   accepted for development traffic. Nothing about the Google registration depends on the
   server's address: the phone talks to Google, the server only verifies the token, and the Web
   client has no redirect URIs to register, so a dev server needs no console change, only its own
   `.env` with `GOOGLE_SIGNIN_CLIENT_ID` and `AUTH_ALLOWED_EMAILS`.
4. **Phase 5 is deferred.** No `role` on `User`, no browser-based provider re-auth, no
   `auth:oauth-state` key for now. The callback escaping in §5 stands on its own.
5. **`applicationId` stays `com.example.domoticgiraffe`.**
