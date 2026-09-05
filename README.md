# DJ Nounoune

DJ Nounoune is a NestJS backend that turns natural-language requests into music playlists and
plays them on a [Music Player Daemon](https://www.musicpd.org/) (MPD). The library it plays from
is aggregated from local files, Qobuz, Spotify and YouTube into one MongoDB catalogue, searched
through OpenSearch neural search, and driven by Google Gemini agents that pick, queue and comment
on the music.

The same codebase ships three faces:

- **A chat server** (REST + Socket.io) that a client talks to in plain language.
- **A CLI** for importing, enriching, de-duplicating and indexing the library, and for driving
  the streaming services and MPD by hand.
- **A public display** at `/vibing-on` showing what is playing, with weather and a sky-cycle palette.

Architecture notes for contributors live in [CLAUDE.md](CLAUDE.md), the rules in
[`.agent/rules/`](.agent/rules/) and the longer references in [`doc/`](doc/).

## Requirements

| Dependency | Notes |
|---|---|
| Node.js **24+**, npm **11+** | Enforced by `engines` and `engine-strict` in `.npmrc`. |
| MongoDB | Any recent server. Connection string plus database name, see [Core](#core). |
| MPD | The player. The app talks the MPD line protocol over TCP. |
| OpenSearch with ML Commons | Neural / kNN search over the songs index. Required by importers, de-duplication, the profiler and the AI agents. |
| Google Gemini API key | Everything AI-related. |
| `ffprobe` on `PATH` | Only for `music enrich --Ffprobe` (technical metadata of local files). |
| Redis | Optional. Without it cache calls are no-ops. |
| Elasticsearch + Zentity | Optional, legacy. Reachable from the CLI only; OpenSearch is the live engine. |
| Stream proxies for MPD | Only if you want Qobuz, Spotify or YouTube playback: MPD cannot play those streams natively, so each source is queued through a proxy URL (see the per-service sections). |

## Quick start

```bash
git clone <repository-url>
cd dj-nounoune
npm install
cp .env.template .env      # then fill it in, see Configuration
npm run build              # must compile clean
npm run start:dev          # REST + WebSocket server on http://localhost:3000
```

Without `MONGODB_URI` and `GENAI_API_KEY` almost nothing boots. Once the server is up, run
`npm run cli -- --help` to see the command tree.

## Configuration

All configuration is environment variables, read from `.env` at the repository root
(`.env.template` lists every key with comments). Nothing is required beyond the Core group; each
service is only needed if you use it, and the app logs what it is missing rather than crashing.

### Core

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB connection string. |
| `MONGO_DATABASE` | yes | Database name. |
| `MONGO_USER`, `MONGO_PASSWORD` | no | Credentials, when not embedded in the URI. |
| `GENAI_API_KEY` | yes | Google Gemini API key ([AI Studio](https://aistudio.google.com/)). |
| `AUTHX_API_KEY` | yes | Shared secret clients send as `x-api-key` on REST and WebSocket. There is no other auth. |
| `PORT` | no | HTTP port, default `3000`. |
| `LOG_LEVEL` | no | `error`, `warn`, `info` (default), `debug` or `verbose`. |
| `ACTIVE_SOURCE_TYPES` | no | Comma-separated sources the AI agents may search and play: `file`, `qobuz`, `spotify`, `youtube`, `applemusic`. Empty means all. Data for a removed source stays in the database and the CLI keeps using it; only the agents ignore it. Useful when a subscription lapses. |

### MPD

| Variable | Description |
|---|---|
| `MPD_HOST` | Host of the MPD server. |
| `MPD_PORT` | Port, default `6600`. |

### Local file library

Local files are imported from a pipe-separated (PSV) export of your tag library, see
[`files/import.template.psv`](files/import.template.psv) for the columns.

| Variable | Description |
|---|---|
| `IMPORT_LIBRARY_PATH_STYLE` | `Windows` or `Linux` (default), the path convention used in the PSV. |
| `IMPORT_LIBRARY_PATH_ROOT` | Root of the library as written in the PSV, e.g. `D:\Music\`. Keep the trailing separator. |
| `LIBRARY_ROOT_PATH` | The same root as MPD sees it, e.g. `/music/`. Keep the trailing `/`. Paths are rewritten from the first to the second on import. |

### Google Gemini

Only `GENAI_API_KEY` is needed. Models are pinned in code to `gemini-3-flash-preview` and
`gemini-3-pro-preview`. Large grounding documents (the database profile, the enrich instructions)
are written to `files/` and uploaded as Gemini cached content; an edited prompt does nothing until
the cache is cleared:

```bash
npm run cli -- promptus clear-cache
```

See [doc/promptus-architecture.md](doc/promptus-architecture.md) and
[doc/promptus-caching.md](doc/promptus-caching.md).

### Spotify

| Variable | Description |
|---|---|
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | From the [Spotify developer dashboard](https://developer.spotify.com/dashboard). |
| `SPOTIFY_REDIRECT_URL` | OAuth callback, `http://127.0.0.1:3000/auth/spotify/callback` for a local server. Must be registered verbatim on the app. |
| `SPOTIFY_PROXY_AUDIO` | Base URL of the proxy MPD streams Spotify audio from. Required only to *play* Spotify sources, which includes the negentropy upgrade: without it Spotify is left out of the ladder. |

Setup:

1. Create an app on the dashboard and add the redirect URL above.
2. **Add your Spotify account under the app's User Management.** New apps are in Development
   mode, where only listed accounts (up to 25) receive usable tokens. Without this every call,
   even public ones, answers `HTTP 403 The user is not registered for this application`, and
   re-authenticating does not help.
3. Start the server, then in another shell:

   ```bash
   npm run cli -- spotify auth
   ```

   Open the printed URL, approve, and the session lands in `.spotify-session.json`. The token is
   refreshed automatically while the app runs.
4. Check it works, then import the account's liked songs:

   ```bash
   npm run cli -- spotify list --limit 5
   ```

   ```bash
   npm run cli -- spotify import --dry-run --limit 20
   ```

Scopes requested: `user-read-private`, `user-read-email`, `user-library-read`,
`playlist-modify-public`, `playlist-modify-private`.

### Qobuz

Qobuz has no public developer program; the app id, secret and OAuth private key are the ones the
web player itself uses, captured from its bundle and from its OAuth handshake. The comments in
`.env.template` describe where to look.

| Variable | Description |
|---|---|
| `QOBUZ_APP_ID`, `QOBUZ_APP_SECRET` | Catalogue API credentials. |
| `QOBUZ_OAUTH_APP_ID`, `QOBUZ_OAUTH_PRIVATE_KEY` | OAuth login credentials. |
| `QOBUZ_API_BASE`, `QOBUZ_OAUTH_URL` | API and OAuth endpoints. |
| `QOBUZ_REDIRECT_URL` | OAuth callback, `.../auth/qobuz/callback`. |
| `QOBUZ_STREAM_PROXY_SERVER` | Base URL of the proxy MPD streams Qobuz audio from. Required to play Qobuz sources and for the negentropy upgrade. |

```bash
npm run cli -- qobuz auth
```

writes `.qobuz-session.json`. Then `qobuz favorites`, `qobuz favorite-albums`,
`qobuz import-favorite-albums` and the search commands are available.

### YouTube

Search, lookups and playlist import only need an API key. OAuth is required solely for the
signed-in account's liked videos and private playlists.

| Variable | Description |
|---|---|
| `YOUTUBE_API_KEY` | Key from a Google Cloud project with **YouTube Data API v3** enabled. |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | OAuth client from the same project. Use a *Desktop app* client with a loopback redirect, Google rejects private hostnames. |
| `YOUTUBE_REDIRECT_URL` | Defaults to `http://localhost:3000/auth/youtube/callback`. |
| `YOUTUBE_PROXY_AUDIO` | Mopidy proxy serving the audio to MPD, e.g. `http://localhost:8666`. |

Mind the quota: 10,000 units a day by default, and a search costs 100 of them while id lookups
cost 1. A playlist is imported as an album, the uploading channel as the artist.

```bash
npm run cli -- youtube auth
```

writes `.youtube-session.json`.

### Search engines

| Variable | Description |
|---|---|
| `OPENSEARCH_NODE`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD` | The live engine. Falls back to the `ELASTIC_*` values when unset. |
| `ELASTIC_NODE`, `ELASTIC_USERNAME`, `ELASTIC_PASSWORD`, `ELASTIC_CERTIFICATE` | Legacy Elasticsearch, CLI only. |

First-time OpenSearch setup creates the index, ingest pipeline and deploys the embedding model,
then indexes the library:

```bash
npm run cli -- opensearch create
```

```bash
npm run cli -- opensearch index
```

### Redis (optional)

`REDIS_URL`, or `REDIS_HOST` / `REDIS_PORT` / `REDIS_USERNAME` / `REDIS_PASSWORD` / `REDIS_DB` /
`REDIS_TLS`, plus `REDIS_KEY_PREFIX` (default `dj-nounoune`), `REDIS_TTL_SECONDS` (default 3600)
and `REDIS_CONNECT_TIMEOUT_MS` (default 2000). Leave all unset to run without a cache.

### Public display and background jobs

| Variable | Default | Description |
|---|---|---|
| `VIBING_LATITUDE`, `VIBING_LONGITUDE` | Montreal | Where the display is, for weather and the sun cycle. |
| `VIBING_WEATHER_ENABLED` | `true` | `false` shows the clock alone. Weather comes from Open-Meteo, no key needed. |
| `VIBING_ALBUM_COVER_SEARCH` | `true` | `false` stops the web search for artwork the importers lacked. |
| `VIBING_TRACE_PACKETS` | `false` | Log every packet on the `/vibing` namespace. |
| `NEGENTROPY_ENABLED` | `true` | `false` stops the 20s pass that swaps low-quality queued files for their Qobuz stream. |

### Session and secret files

`.spotify-session.json`, `.qobuz-session.json` and `.youtube-session.json` hold live tokens at the
repository root. They and `.env` are gitignored and kept out of the Docker image by
`.dockerignore`. `client/` holds the MongoDB TLS client certificate and root CA when the server
requires them.

## Running the server

```bash
npm run start:dev      # watch mode
```

```bash
npm run start:prod     # runs dist/main after npm run build
```

`npm run start` and `npm run start:debug` also exist. `IS_CLI` is never set for the server, so the
schedulers, the playlog poller and the negentropy pass all run.

## The CLI

```bash
npm run cli -- <group> <subcommand> [options]
```

Note the `--` before the arguments. The CLI boots the same NestJS module as the server with
`IS_CLI=true`, which suppresses cron jobs and pollers. Most mutating commands accept `--dry-run`;
long-running ones accept `--limit`.

| Group | Subcommands |
|---|---|
| `music` | `import -f <psv> [-p playlist] [-d]`, `clear [-c songs albums artists] [-d]`, `enrich [--ai] [--bpm] [--Ffprobe] [--clear-cache] [-l n] [-b n] [--createdAt yyyy-mm-dd]`, `lyric-semantic [-l n] [-b n] [-c n]`, `dedup search`, `dedup process [-d]`, `whats-playing [-a artist] [-l album] [--no-cover] [--no-commentary]`, `migrate-technical-info`, `migrate-song-source [-d]` |
| `promptus` | `search <query>`, `play <query>`, `chat [-m msg] [-s session] [--show-tools] [-q] [-j]`, `clear-cache` |
| `mpd` | `test`, `add`, `play`, `clear`, `shuffle`, `playlist` |
| `spotify` | `auth`, `list [-l n or all]`, `import [-d] [-l n]`, `search-track [-t] [-a] [-b] [-l] [--all] [-j]`, `search-artist -a <artist> [-b] [-t] [-l] [-j]` |
| `qobuz` | `auth`, `favorites`, `favorite-albums`, `import-favorite-albums`, `search-track [-t] [-a] [-b] [-l] [--all] [-j]`, `find-artist-track -a <artist> [-b] [-t] [-l] [-j]`, `search-current-track [-j]` |
| `youtube` | `auth`, `search-track [-t] [-a] [-b] [-l] [-j]`, `search-playlist [-l] [--tracks] [-j]`, `import-playlist <id> [-d]`, `play <videoId> [-p playlistId] [-s title -a artist] [-c]`, `liked [-l] [-j]`, `playlists [-l] [-j]` |
| `opensearch` | `create`, `index [-f n] [-a yyyy-mm-dd]`, `prune`, `semantic <text> [-r] [-l n]` |
| `elastic` | `create-index`, `index-songs [-f n] [-a yyyy-mm-dd]`, `prune-index` |
| `profiler` | `run` |
| `negentropy` | `run [-d] [-l n]` |

A typical library bootstrap:

```bash
npm run cli -- music import -f files/my-library.psv --dry-run
```

```bash
npm run cli -- opensearch index
```

```bash
npm run cli -- music enrich --ai --limit 200
```

```bash
npm run cli -- music dedup search
```

```bash
npm run cli -- music dedup process --dry-run
```

## HTTP and WebSocket API

Every REST call and WebSocket handshake must carry `x-api-key: <AUTHX_API_KEY>`.

### Chat rooms (`/chatroom`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/chatroom` | Create a room, body `{ "topic": "...", "userId": "..." }`. |
| `GET` | `/chatroom` | List rooms. |
| `GET` | `/chatroom/:id` | One room. |
| `GET` | `/chatroom/:id/history` | Its message history. |
| `DELETE` | `/chatroom/:id` | Delete it. |

```bash
curl -X POST http://localhost:3000/chatroom -H "x-api-key: $AUTHX_API_KEY" -H "Content-Type: application/json" -d '{"topic":"Friday night","userId":"alex"}'
```

### Chat over Socket.io (default namespace)

Connect with `x-api-key` and `x-user-id` as headers, or as `auth: { apiKey, userId }` in the
handshake. The server joins the socket to a session room and resumes it on reconnect.

| Direction | Event | Payload |
|---|---|---|
| client to server | `chat-message` | The user's text. |
| client to server | `chat-feedback` | Feedback on a previous answer. |
| server to client | `chat-message-response` | The agent's answer. |
| server to client | `chat-message-status-response` | Progress while tools run (searching, queueing, ...). |

### Auth callbacks (`/auth`)

`GET /auth/spotify/callback`, `/auth/qobuz/callback` and `/auth/youtube/callback` complete the
three OAuth flows started by the `auth` CLI commands. The server must be running for them.

### Public display (`/vibing-on`)

`GET /vibing-on` serves the page; `/vibing-on/now-playing`, `/vibing-on/weather` and
`/vibing-on/artwork/:songId` feed it, and the `/vibing` Socket.io namespace pushes track changes.

## Development

```bash
npm run build          # nest build. The validation gate: run it after every change
```

```bash
npm run typecheck      # TypeScript 7 native tsc, --noEmit. Fast pre-check, not a substitute for build
```

```bash
npm run lint           # eslint --fix
```

```bash
npm run format         # prettier
```

Tests:

```bash
npm test                                             # unit tests, *.spec.ts under src/
```

```bash
npm test -- src/services/file/file.service.spec.ts   # one file
```

```bash
npm run test:integration                             # test/integration, needs live credentials
```

`test:watch`, `test:cov`, `test:debug` and `test:e2e` are also defined. Unit coverage is thin by
design; a clean `npm run build` is the real gate.

Conventions that are easy to trip on, spelled out in [CLAUDE.md](CLAUDE.md):

- No `any`. `unknown` plus narrowing, and Zod at every external boundary.
- Catch variables are `unknown`; use `getErrorMessage` from `src/utils/error.utils.ts`.
- `typescript` stays on **6**. TypeScript 7 is installed under the `tsgo` alias for `typecheck`
  only; the NestJS CLI, ts-node, ts-jest and typescript-eslint cannot run on it yet.
- CLI commands are thin. Logic lives in `src/services/`, and every command class is registered in
  `src/cli/command.provider.ts`.
- Schema `@Prop({ description })` strings are rendered into the LLM grounding document. Keep them
  true.

### Dependency hygiene

```bash
npm run security:check
```

runs `npm audit` at moderate, verifies registry signatures and lists any package whose install
script has not been reviewed. Install scripts are allow-listed by exact version in `package.json`
`allowScripts`; approve a bumped one with `npm approve-scripts <pkg>` after reading it, never
`--all`. `.npmrc` enforces a 7-day `min-release-age`, so a freshly published version waits a week
unless you override per command with `--min-release-age=0`. Dependabot opens grouped weekly PRs
for minor and patch bumps.

## Build, Docker and release

### Build

`npm run build` compiles to `dist/`; `node dist/main` (or `npm run start:prod`) runs it. The
build reads `tsconfig.build.json`.

### Docker image

The [Dockerfile](Dockerfile) is a four-stage build on `node:26-alpine`: a builder stage installs
everything and runs `nest build`, a deps stage installs production dependencies only, and the
final image copies `dist/` and that `node_modules` in, runs as the unprivileged `node` user and
exposes port 3000. Both `npm ci` calls run `--ignore-scripts`. `.env`, the session token files
and `node_modules` are excluded by `.dockerignore`, so configuration must be passed at run time:

```bash
docker run --env-file .env -p 3000:3000 dj-nounoune:latest
```

Individual steps:

| Script | What it does |
|---|---|
| `npm run docker:build` | `docker build` with `--network=host`, passing the package version as `APP_VERSION` (surfaced as `npm_package_version` in the container), tagged `dj-nounoune:latest`. |
| `npm run docker:tag` | Retags as `dockerhub.supa-smart.lan/dj-nounoune:latest`. |
| `npm run docker:push` | Pushes to that private registry. |

### Release

```bash
npm run release
```

runs, in order: `npm version minor`, then `docker:build`, `docker:tag`, `docker:push`. Before you
run it:

- The working tree must be clean: `npm version` refuses to run otherwise, and it creates a commit
  and a `vX.Y.0` tag.
- Docker must be running and logged into the private registry.
- Run `npm run build` and `npm run security:check` first; `release` does not lint or test.

After it finishes, push the commit and the tag:

```bash
git push --follow-tags
```

For a patch or major bump run `npm version patch` or `npm version major` by hand, then the three
`docker:*` scripts.

## Project structure

```text
src/
├── main.ts                 REST + Socket.io entry point
├── cli.ts                  CLI entry point (sets IS_CLI=true)
├── app.module.ts           The single module both entry points boot
├── cli/                    nest-commander command classes, one folder per group
├── controller/             REST controllers (chatroom, auth callbacks, vibing-on)
├── gateway/                Socket.io gateways (chat, /vibing)
├── schemas/                Mongoose schemas; Artist -> Album -> Song, multi-source Song
├── services/
│   ├── promptus/           Gemini agents, requests, responses and tool handlers
│   ├── music-db/           The one Mongo access layer
│   ├── opensearch/         Neural search, mappings generated from the schemas
│   ├── merge/              De-duplication merge policy (field-resolver.ts)
│   ├── mpd-client/         Hand-rolled MPD line-protocol client
│   ├── spotify/ qobuz/ youtube/   Streaming service clients and importers
│   ├── negentropy/         Queue quality upgrade pass
│   └── weather/            Open-Meteo for the display
├── lexic/                  Controlled vocabulary shared by every prompt
└── public/vibing/          The /vibing-on page (no build step)
doc/                        Architecture references
files/                      Grounding documents, prompt cache material, PSV import template
test/                       Integration tests
client/                     MongoDB TLS certificates
```

## License

UNLICENSED. See [LICENSE](LICENSE).
