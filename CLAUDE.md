# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build              # nest build — THE validation gate (see Testing below)
npm run typecheck          # TypeScript 7 native tsc, --noEmit on tsconfig.build.json; fast pre-check, not a substitute for build
npm run start:dev          # REST + WebSocket server, watch mode
npm run lint               # eslint --fix
npm run format             # prettier

npm test                                        # unit tests (*.spec.ts under src/)
npm test -- src/services/file/file.service.spec.ts   # single test file (jest rootDir is src/)
npm test -- -t "some test name"                 # single test by name
npm run test:e2e                                # test/**/*.e2e-spec.ts (currently only test/integration)
npm run test:integration                        # test/integration/** (needs live credentials)

npm run cli -- <command> [subcommand] [options] # CLI (note the `--`)
npm run release            # npm version minor + docker build/tag/push
```

Requires a `.env` file — copy `.env.template` and fill it. Without `MONGODB_URI` and `GENAI_API_KEY` almost nothing boots.

### CLI command tree

`npm run cli -- <group> <subcommand>`. Groups: `music` (import, clear, enrich, migrate-technical-info, migrate-song-source, dedup {search,process}), `mpd` (test, add, play, clear, shuffle, playlist), `promptus` (search, play, chat, clear-cache), `spotify` (auth, list, import), `qobuz` (auth, favorites, favorite-albums, import-favorite-albums, search-track, search-current-track), `youtube` (auth, search-track, search-playlist, import-playlist, play, liked, playlists), `elastic` (create-index, index-songs, prune-index), `opensearch` (create, index, prune), `profiler` (run), `negentropy` (run).

Most mutating commands accept `--dry-run`. Long-running ones accept `--limit` and `--created-after yyyy-mm-dd`.

## Architecture

A NestJS backend that turns natural-language requests into music playlists, driving a Music Player Daemon (MPD) instance over a library aggregated from local files, Qobuz, and Spotify.

### Two entry points, one module

`src/main.ts` (HTTP + Socket.io) and `src/cli.ts` (nest-commander) both bootstrap the **same** `AppModule`. `src/cli.ts` sets `IS_CLI=true`, which suppresses `ScheduleModule`/`SchedulersModule` and the playlog poller — otherwise every CLI invocation would start cron jobs. Adding background work? Gate it on `IS_CLI` the same way.

### The multi-source song model

The keystone is `src/schemas/source.schema.ts`. One logical song is **one** `Song` document carrying a `source: SongSource[]` array (`file` | `qobuz` | `spotify` | ...), each with its own `path` and embedded `TechnicalInfo` (bitrate, sample rate, `is_high_res`). Importers never blindly insert: they fuzzy-search OpenSearch first and attach a new `SongSource` to the existing document. Playback picks the best source at play time by scoring quality (`PlayMusicHandler.getBestSource`).

Domain triangle is `Artist → Album → Song` by ObjectId ref. `MusicDbService` (`src/services/music-db/`) is the single Mongo access layer; go through it rather than injecting models directly.

`@Prop({ description: '...' })` strings on schemas are **load-bearing** — `ProfilerService` renders them into the LLM grounding document. Keep them accurate when adding fields.

### Search: OpenSearch is current, Elasticsearch is legacy

Both index a `songs` index and both exist. **OpenSearch** (`src/services/opensearch/`) is the live one — neural/kNN search via ML-Commons with a multilingual sentence-transformer, wired into importers, mergers, the profiler, and the AI agents. Its mappings are generated from the Mongoose schemas (`dynamic-mapping.util.ts`), so schemas remain the source of truth. **Elasticsearch** (`src/services/elasticsearch/`) uses the Zentity entity-resolution plugin and is reachable **only from CLI**. Prefer OpenSearch for new work. `OPENSEARCH_*` env vars fall back to `ELASTIC_*`.

Dedup flow: `music dedup search` writes `Deduplication` groups → `music dedup process` merges them via `MergeService`.

### Merge policy lives in one file

`src/services/merge/mergers/field-resolver.ts` holds the entire conflict-resolution policy: non-empty beats empty → genre prefers the `file` source → text fields prefer the non-ASCII value (keeps CJK originals over romanizations) → otherwise prefer `qobuz`. `MergeService` cascades artists → albums → song, reloading documents between steps because refs get re-pointed. Change merge behaviour there, not in the individual mergers.

### Promptus: the AI layer (`src/services/promptus/`)

Google Gemini via `@google/genai`. Read `.agent/rules/promptus.md` and `.agent/rules/genai.md` before touching this — they are the authoritative spec for *behaviour*. For the **object model** — the `Agent` / `PromptusRequest` / `PromptusResponse` / `ToolHandler` contracts, the four request shapes, and the invariants that compile cleanly but fail at runtime — read [`doc/promptus-architecture.md`](doc/promptus-architecture.md); context caching has its own file, [`doc/promptus-caching.md`](doc/promptus-caching.md). Adding or changing a prompt is covered end to end by the `promptus-prompt` skill (`.claude/skills/promptus-prompt/`). Key structural facts:

- **`Agent`** (`agent.ts`) is the abstract base running the function-calling loop (max 10 iterations, then throws). Agents are **stateless** — conversation history lives on the *request* object. Subclasses call `initialiseAgent(apiKey, toolService, eventEmitter)` from their constructor rather than relying on DI, which is why sub-agents can be plain-`new`ed.
- **`PromptusRequest<TResponse>`** carries model, system instruction, query, tools, history and a phantom response type, so `agent.generate(request)` is statically typed to the matching response class. Each concrete agent implements `wrapResponse` as an `instanceof` chain.
- **`ToolsService`** holds a `Map<name, ToolHandler>`. Stateless handlers register in the constructor; agent-delegating handlers register in `initialiseAgent(...)`, which `PromptusService`'s constructor calls — this is the deliberate break in the circular dependency (agents need tools, tools need agents).
- **Agents are exposed as tools.** `ChatPromptusRequest` (top-level, user-facing) declares `disc_jockey_create_playlist` etc.; those handlers call into `DiscJockeyAgent`, which itself calls `search_music_database` → `QueryDatabaseAgent`. Three levels deep. `sessionId` is threaded all the way down so nested agents emit progress to the same WebSocket session.
- **Tool handlers return errors as `FunctionCallResult` strings** rather than throwing, so the model can self-correct.
- **Grounded requests are a separate shape.** `PromptusRequest.grounded` adds Google Search; Gemini then rejects both function declarations and a `responseSchema`, so `album-cover`, `artist-performance` and `music-talk` all declare `tools = []` and answer in prose. `artist-performance` is handed the current date in its query — "upcoming" means nothing to a model whose knowledge stops before now.
- **The Qobuz tools bypass the library entirely** (`tools/handler/qobuz/`): `qobuz_search_artist` → `qobuz_start_playback` streams a recording that has no song document, and nothing is written to Mongo on the way (attaching a qobuz source is the negentropy pass's job, and only for songs that already exist). A search returning no artist is reported as a *final answer*, worded to stop the model retrying spellings until the thinking loop throws.
- **`qobuz_add_favorite` saves albums by default.** Its `scope` is `album` unless the user singled out the recording — people collect records, so "save this" said over a playing track means the album. A track id under `scope: album` is therefore resolved to its album through the catalog rather than favourited as a track, which also covers the id gap: `current_song` only reports a `qobuzAlbumId` when the *album document* carries a qobuz source, while `qobuzTrackId` is there whenever a Qobuz stream is playing. The handler names what it saved in its reply — favouriting the wrong record is only obvious if the user is told which one it was.
- **`current_song` answers from `PlaylogService`, not from MPD.** It hands back the same enriched snapshot the /vibing-on page renders, plus the Qobuz track/album ids `qobuz_add_favorite` needs. `PlaylogService` already injects `ToolsService`, so it registers itself through `ToolsService.setNowPlayingSource` (the `NowPlayingSource` interface in `now-playing.event.ts`) rather than closing the cycle. The snapshot is only handed out once MPD confirms the same song is still loaded — nothing clears it when playback stops — and a null falls the handler back to MPD, which is also what happens under `IS_CLI`.

### The MPD queue is mixed, and `parseSourceUri` is what untangles it

One playlist holds local files, Qobuz streams, Spotify streams and YouTube streams side by side — queued by `PlayMusicHandler`, by `qobuz_start_playback`, by `youtube play`, by the negentropy swap, or by any other client pointed at the same daemon. The only thing tying a queue entry back to a song document is the shape of its uri, so **`src/config/source-uri.util.ts` owns both directions**: `qobuzStreamUri` / `spotifyStreamUri` / `youtubeStreamUri` build them, `parseSourceUri` reads them back to a `{ name, sourceId }` that matches `SongSource` directly. Build in one file and parse in another and the playlog silently stops recognising half of what plays — which is exactly what happened while every reader hardcoded `file.includes('/qobuz/track/')` and treated everything else as a local path.

- Consumers: `PlaylogService.getMpdSong` (one source-agnostic Mongo match instead of a branch per provider), `CurrentSongHandler.fromMpd`, and the negentropy candidate filter (only `file` entries can be upgraded).
- Unrecognised shapes fall through as `file`, which is right: MPD's own music directory is addressed by plain relative paths. The patterns are anchored on provider markers (`spotify:track:`, not `spotify`) so a local path that merely contains a provider's name is not misread.
- `youtube` matches two shapes: `yt:video:<id>`, which is what this app queues through the Mopidy proxy, and the watch-url forms another client may have queued instead. Both resolve to the same 11-character video id. `applemusic` is deliberately absent: nothing queues it and its uri shape is unknown.
- **Context caching**: large grounding data (the DB profile, the enrich instructions) is written to `files/` by `FileService` and uploaded as a Gemini `CachedContent` (get-or-create keyed on display name). The instruction for a cached request **travels with the cache, not with the request** — as the cached file's content (what `enrich-instruction` does, hence `EnrichMetadataRequest._context = ''`) or as `ReadonlyAgentCache.cacheInstruction` (what the DJ query generator does). When `request.cache` is set, `context`, `tools` and `grounded` are all omitted from the outbound request; only `structuredResponse` still applies. Cache model must match request model, and because the get-or-create never compares content, an edited prompt does nothing until `npm run cli -- promptus clear-cache`. Full semantics in [`doc/promptus-caching.md`](doc/promptus-caching.md).
- Handlers return PSV (pipe-separated) rather than JSON in several places purely to save tokens.

`src/lexic/songs.description.ts` is the controlled vocabulary (emotions, BPM-band pace names, genre taxonomy) shared by every prompt. It is what keeps enrichment output in a closed set — extend it there, not inline in a prompt.

### YouTube: a playlist is an album (`src/services/youtube/`)

The YouTube Data API v3, hand-rolled on `fetch` with Zod at the boundary — no third-party client.
Shaped like `QobuzService` (search, lookup, import, a `SongSource` builder) with three things that
are genuinely different.

- **Auth is split, and mostly unnecessary.** Search, video, channel, playlist and playlist-item
  lookups are public data reachable with `YOUTUBE_API_KEY` alone. OAuth exists *only* for the
  signed-in account's liked videos and private playlists. The service works with a key alone and
  logs that fact rather than throwing. `youtube auth` is Google's standard authorization-code
  redirect, `.youtube-session.json` at the repo root, refresh token renewed on a one-minute check.
  Google validates the redirect uri far more strictly than Qobuz: a `.lan` host is rejected
  outright, so `YOUTUBE_REDIRECT_URL` defaults to loopback.
- **A playlist is the album.** A video has a title, a channel and a duration — nothing that maps
  onto `Artist → Album → Song`. A playlist is the only YouTube object with album structure
  (ordered, titled, artwork, stable id), so **playlist → `Album`**, **channel → `Artist`** (with the
  YouTube Music ` - Topic` suffix stripped), **video → `Song`** with `track_number` from the
  playlist position. `importPlaylist` is therefore the *only* path that writes songs; `youtube play`
  and `searchTracks` queue without touching Mongo, the same stance `PlayQobuzHandler` takes. The
  album artist is the dominant *uploading* channel across the tracks, not the playlist owner — on an
  auto-generated release playlist (`OLAK5uy_…`) the owner is YouTube Music and the uploader is the
  artist. Below 60% agreement it is a compilation and the owner wins.
- **`youtube-track-match.util.ts` is where the difficulty lives.** Everything downstream depends on
  splitting one free-text upload title into artist and title. `parseVideoTitle` handles the
  separator conventions (a ` - ` needs its spaces, so `Jay-Z` survives), trusts a Topic channel over
  splitting at all, and **returns an empty artist rather than guessing** — a wrong guess poisons
  every dedup lookup, which keys on the artist. `stripTitleNoise` peels trailing bracket groups one
  at a time, keeping the ones that name a different recording (remix, live, acoustic) and dropping
  promotional ones; it peels *behind* a kept group, or `(Official Video) [4K Remaster]` would keep
  both.

Quota is the operational constraint: 10,000 units/day by default, `search.list` costs **100**,
`videos.list` and `playlistItems.list` cost **1**. Hence the short fallback-query chain, the batched
`videos.list` for details, and id-based lookups wherever an id is already known.

The YouTube source's `TechnicalInfo` assumes the **Premium 256 kbps AAC** rendition at 44.1 kHz
(`is_cd_quality: false`). Those numbers place it in the quality order rather than merely describing
it, because `PlayMusicHandler.getBestSource` scores exactly those fields on one additive scale:
lossless sources take the 500,000 `is_cd_quality` bonus and win outright; against the other lossy
streams it is the **bitrate term** that separates 256 from Spotify's 320 kbps Ogg, not the per-source
name bonus — so YouTube lands under Spotify and over the library's 128/192 kbps mp3s, which is the
intended result. The `+1` name bonus only settles a tie with an equal-bitrate local file. Overstate
any of it and a YouTube re-encode outranks a local FLAC. In `field-resolver.ts` any source beats
youtube on a *metadata* conflict, because its values were guessed rather than delivered.

The chat reaches YouTube through three tools (`tools/handler/youtube/`): `youtube_search_music` and
`youtube_start_playback` are the fallback pair for what Qobuz lacks and write nothing, and
`youtube_import_to_library` is the YouTube counterpart of `qobuz_add_favorite` — it runs the same
`importPlaylist` as the CLI. A video id handed to it is never imported alone: the Data API has no
video-to-album link, so the handler searches playlists (by the `album_title` hint first, then by
artist and track), opens the release playlists among the hits and imports the first one that
actually contains the video. `current_song` reports a YouTube stream as `sourceName: youtube` with
the video id in `sourceId`, which is what the prompt tells the model to pass.

Not wired in: the negentropy pass still only upgrades `file` sources, so a queued YouTube stream is
never swapped for its Qobuz equivalent.

### Chat request flow

Socket.io client → `ChatGateway` (validates `x-api-key` + `x-user-id`, joins a session room) → `SessionService` (in-memory sessions over the `Connection` collection) → `ChatService` per-session RxJS channels → `PromptusService.generate(ChatPromptusRequest)` → tool loop → results emitted back as `EventEmitter2` events (`chat.message.response`, `chat.status.response`) that the gateway relays. Chat history persists as Gemini `Content` objects directly in the `Chat` document.

REST (`ChatController`, `/chatroom`) is CRUD-only and guarded by `ApiAuthGuard` (`AUTHX_API_KEY` via `x-api-key`). No real auth — shared key only.

### Negentropy: the queue quality upgrade

`src/services/negentropy/` scans the MPD queue **ahead of the playhead** every 20s, finds entries playing from a low quality local file, and swaps them for the Qobuz stream of the same recording — attaching the qobuz `SongSource` to the song document on the way.

- **Interval, not event.** MPD is the source of truth for what plays next and any other client can reorder the queue, so the pass re-reads `status` + `playlistinfo` rather than reacting to a change of its own.
- **`negentropy_job` is the anti-spam ledger.** One document per song, unique on `songId`, written for `upgraded`, `no_match` **and** `failed` alike. Without it a 20s cycle would re-query Qobuz about an unchanged queue. Delete a document to force a re-check; `no_match` is otherwise permanent.
- Candidates are decided by `quality.util.ts`: lossy format, or sub-CD-quality technical info, or no technical info at all. Only `file` sources qualify.
- Match threshold is **0.85** (`QobuzService.findTrack`), higher than the CLI default — this replaces something already queued.
- The swap is `addid <uri> <pos>` then `deleteid <old id>`, in that order: a failed delete duplicates a track, a failed add after a delete would lose it. Deleting by id is what keeps it correct after the insert shifts positions.
- A song that already carries a qobuz source is swapped with no lookup and no job record — the uri check skips it on the next pass.
- **Artwork rides along with the source.** The Qobuz response already carries the album cover, so it is written to the song's album document when that album has none (`MusicDbService.setAlbumImageIfMissing`, never an overwrite). This is not cosmetic: MPD can read a picture out of a local file but not out of a proxied stream, so a swap would otherwise leave the track with no artwork. MPD has **no artwork tag** — `addtagid` rejects Artwork/Picture/AlbumArt with `Unknown tag type` — the album document is the only place the cover can live. The `reused` path does not do this, since no source is being added and the track payload is not in hand.
- Gated by `NEGENTROPY_ENABLED` (on when unset) and by `IS_CLI`, same as the playlog poller. `npm run cli -- negentropy run [--dry-run]` runs one pass by hand.

### The public display (`/vibing-on`)

Three static files under `src/public/vibing/`, served by `VibingController` and fed live by the
`/vibing` websocket namespace. No build step — plain ES5-style JS in one IIFE, so match that (`var`,
`function`, string concatenation) rather than reaching for modern syntax.

The header carries a 24h clock and the weather, and the page's whole palette is painted from the sun
cycle. `WeatherService` (`src/services/weather/`) is the one thing behind it: an Open-Meteo call
( no key, no account ) reduced to conditions plus a five day outlook plus **sunrise and sunset as
epoch milliseconds**, cached ten minutes in memory and shared by every viewer. Served at
`GET /vibing-on/weather`, answering `null` when `VIBING_WEATHER_ENABLED=false`.

- **The sky is the whole palette, not just the background.** `paintSky` in `vibing.js` interpolates
  one HSL colour between nine anchors keyed off sunrise and sunset, then derives `--bg`, `--bg-sunk`,
  `--bg-panel`, `--bg-tile` and `--line` from it. Change the look there; the stylesheet holds only
  the night values, as the first-paint default.
- **The daylight end stops at a deep blue on purpose.** The page is light type on dark, and a
  literal midday sky would mean inverting the whole palette. `--ink` never falls below 8:1 against
  the background at any hour.
- **`--ink-2/3/4` are repainted too.** They were picked against black and would sink into a lit
  background, so they are mixed towards a lighter set by a `lift` read off the sampled lightness —
  one number driving both, which is what keeps them in step.
- A hardcoded grey that reads as raised against the night background reads as a hole against the
  daylight one. New hover and tile states go through `color-mix` off `--bg-tile` / `--line`.
- Everything degrades: no weather upstream means the clock alone and a fixed six to six day.

`VIBING_LATITUDE` / `VIBING_LONGITUDE` place the display; unset means Montreal. The service is lazy,
so the CLI never triggers a call and needs no `IS_CLI` gate.

### MPD client

`src/services/mpd-client/` is a hand-rolled TCP client for the MPD line protocol: one socket, serialized FIFO queue, banner handshake, responses terminated by `OK`/`ACK`. One request class per verb in `requests/`, paired 1:1 with a lazy-parsing response class in `responses/`. Protocol notes in `mpd-client/readme.md`. Add a verb by adding both halves of the pair.

## Conventions

Project rules live in `.agent/rules/` (`project.md`, `cli.md`, `promptus.md`, `genai.md`) and apply to all work here. Longer-form architecture references live in `doc/` — currently [`promptus-architecture.md`](doc/promptus-architecture.md) and [`promptus-caching.md`](doc/promptus-caching.md). The non-obvious ones:

- **No `any`.** Use `unknown` plus narrowing, and Zod at the boundary where a value comes from outside (an API body, a JSON file, a spawned process). `@typescript-eslint/no-explicit-any` is an **error** and the `no-unsafe-*` rules are on, so `npm run lint` refuses new `any`; `noImplicitAny` is still off in tsconfig, so an unannotated parameter is the one gap the linter has to catch for you. Where a third-party type is generic over `any` (mongoose `Schema`, socket.io `handshake.auth`), take the value into an `unknown`-typed local and narrow it rather than passing it through.
- **TypeScript 6 pins `strict: false` deliberately.** TS6 flipped `strict` to default `true`; this project runs the NestJS scaffold posture instead, so `tsconfig.json` sets `strict: false` and opts individual checks back in. `strictNullChecks`, `useUnknownInCatchVariables` and `strictFunctionTypes` are **on**; `strictPropertyInitialization` is **off** because Mongoose `@Prop` and GenAI request/response classes are populated by the framework, never in a constructor. Don't "tidy" this by deleting `strict: false` — that reintroduces 116 property-init errors.
- **Two TypeScripts are installed, and `typescript` must stay on 6.** `typescript@7` is the native Go compiler: its main export is a version stub, with no programmatic compiler API, in 7.0 and in the 7.1 nightlies alike. `@nestjs/cli`, `ts-node`, `ts-jest` and `typescript-eslint` all require that API, so with 7 at the root `nest build`, the CLI, jest and lint each crash on startup. An npm `overrides` block cannot route around it either: npm refuses to nest a peer dependency of a root package, so there is no way to hand those tools a 6 while the root holds a 7. TypeScript 7 is therefore installed under the `tsgo` alias (`npm:typescript@^7.0.2`) and reached by explicit path from `npm run typecheck`. Both packages publish a `tsc` bin, so `npx tsc` may resolve to either; never rely on it, use the script. Revisit once the tools ship TS 7 support.
- **Catch variables are `unknown`.** Use `getErrorMessage(e)` from `src/utils/error.utils.ts` rather than reaching for `e.message`.
- **Zod at every external boundary.** Third-party API responses and untrusted JSON start as `unknown`, get parsed by a Zod schema, and only then propagate as `z.infer<...>`. This is followed consistently in the Spotify/Qobuz/OpenSearch services; match it.
- **CLI commands are thin.** Parse options, call a service. All logic lives in `src/services/`. Register every command class in `src/cli/command.provider.ts` or it will not exist.
- **Gemini models**: use `gemini-3-flash-preview` / `gemini-3-pro-preview`. The 1.5 series and the legacy `@google/generative-ai` SDK are prohibited.

### Testing

Unit tests are largely bypassed in this project. `npm run build` is the real gate — **run it after any change** and make sure it compiles clean. Do not mark work done on a TypeScript error.

### Dependency hygiene

- `npm run security:check` is the supply-chain gate: `npm audit` at moderate, registry signature verification, and a listing of any package whose install script has not been reviewed. Run it after touching `package.json`.
- **Install scripts are allow-listed** in `package.json` `allowScripts` (npm 11), pinned to `pkg@version`. A bump of one of those packages puts it back in the pending list on purpose: read the new script, then `npm approve-scripts <pkg>`. Never `--all`.
- `.npmrc` sets `engine-strict` and a 7-day `min-release-age`. The latter means a fix published this week is not installable until it ages; that is the intended trade against a poisoned release, override per command with `--min-release-age=0` only when the advisory justifies it. Versions already in the lockfile are never re-judged by `npm install` or `npm ci`, but `npm audit signatures` rebuilds the tree and would reject a fresh locked version, which is why the script passes `--min-release-age=0` to that one step.
- `.dockerignore` is what keeps `.env` and the three `*-session.json` token files out of the image. Both Docker `npm ci` calls run `--ignore-scripts`; if a future runtime dependency genuinely needs its install script, drop the flag on the `deps` stage only.
- Dependabot (`.github/dependabot.yml`) opens grouped weekly PRs for minor/patch bumps and ignores majors; those are reviewed by hand.

## Known drift

- `README.md` documents `npm run spotify:auth` and a `docker-compose.yml`; neither exists. Use `npm run cli -- spotify auth`.
- Session tokens are written to `.qobuz-session.json` / `.spotify-session.json` / `.youtube-session.json` at the repo root (gitignored, and currently populated with live tokens).
