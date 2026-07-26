# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build              # nest build — THE validation gate (see Testing below)
npm run start:dev          # REST + WebSocket server, watch mode
npm run lint               # eslint --fix
npm run format             # prettier

npm test                                        # unit tests (*.spec.ts under src/)
npm test -- src/services/file/file.service.spec.ts   # single test file (jest rootDir is src/)
npm test -- -t "some test name"                 # single test by name
npm run test:e2e                                # test/**/*.e2e-spec.ts
npm run test:integration                        # test/integration/** (needs live credentials)

npm run cli -- <command> [subcommand] [options] # CLI (note the `--`)
npm run release            # npm version minor + docker build/tag/push
```

Requires a `.env` file — copy `.env.template` and fill it. Without `MONGODB_URI` and `GENAI_API_KEY` almost nothing boots.

### CLI command tree

`npm run cli -- <group> <subcommand>`. Groups: `music` (import, clear, enrich, migrate-technical-info, migrate-song-source, dedup {search,process}), `mpd` (test, add, play, clear, shuffle, playlist), `promptus` (search, play, chat, clear-cache), `spotify` (auth, list, import), `qobuz` (auth, favorites, favorite-albums, import-favorite-albums), `elastic` (create-index, index-songs, prune-index), `opensearch` (create, index, prune), `profiler` (run).

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

Google Gemini via `@google/genai`. Read `.agent/rules/promptus.md` and `.agent/rules/genai.md` before touching this — they are the authoritative spec. Key structural facts:

- **`Agent`** (`agent.ts`) is the abstract base running the function-calling loop (max 10 iterations, then throws). Agents are **stateless** — conversation history lives on the *request* object. Subclasses call `initialiseAgent(apiKey, toolService, eventEmitter)` from their constructor rather than relying on DI, which is why sub-agents can be plain-`new`ed.
- **`PromptusRequest<TResponse>`** carries model, system instruction, query, tools, history and a phantom response type, so `agent.generate(request)` is statically typed to the matching response class. Each concrete agent implements `wrapResponse` as an `instanceof` chain.
- **`ToolsService`** holds a `Map<name, ToolHandler>`. Stateless handlers register in the constructor; agent-delegating handlers register in `initialiseAgent(...)`, which `PromptusService`'s constructor calls — this is the deliberate break in the circular dependency (agents need tools, tools need agents).
- **Agents are exposed as tools.** `ChatPromptusRequest` (top-level, user-facing) declares `disc_jockey_create_playlist` etc.; those handlers call into `DiscJockeyAgent`, which itself calls `search_music_database` → `QueryDatabaseAgent`. Three levels deep. `sessionId` is threaded all the way down so nested agents emit progress to the same WebSocket session.
- **Tool handlers return errors as `FunctionCallResult` strings** rather than throwing, so the model can self-correct.
- **Context caching**: large grounding data (the DB profile, the enrich instructions) is written to `files/` by `FileService` and uploaded as a Gemini `CachedContent` (get-or-create keyed on display name). Critical constraint: when `request.cache` is set, the system instruction **and tools are omitted** from the request — a cached request cannot use tools. Cache model must match request model.
- `ChatTitleAgent` (`agent/chat-title/`) is entirely commented out. Dead code.
- Handlers return PSV (pipe-separated) rather than JSON in several places purely to save tokens.

`src/lexic/songs.description.ts` is the controlled vocabulary (emotions, BPM-band pace names, genre taxonomy) shared by every prompt. It is what keeps enrichment output in a closed set — extend it there, not inline in a prompt.

### Chat request flow

Socket.io client → `ChatGateway` (validates `x-api-key` + `x-user-id`, joins a session room) → `SessionService` (in-memory sessions over the `Connection` collection) → `ChatService` per-session RxJS channels → `PromptusService.generate(ChatPromptusRequest)` → tool loop → results emitted back as `EventEmitter2` events (`chat.message.response`, `chat.status.response`) that the gateway relays. Chat history persists as Gemini `Content` objects directly in the `Chat` document.

REST (`ChatController`, `/chatroom`) is CRUD-only and guarded by `ApiAuthGuard` (`AUTHX_API_KEY` via `x-api-key`). No real auth — shared key only.

### MPD client

`src/services/mpd-client/` is a hand-rolled TCP client for the MPD line protocol: one socket, serialized FIFO queue, banner handshake, responses terminated by `OK`/`ACK`. One request class per verb in `requests/`, paired 1:1 with a lazy-parsing response class in `responses/`. Protocol notes in `mpd-client/readme.md`. Add a verb by adding both halves of the pair.

## Conventions

Project rules live in `.agent/rules/` (`project.md`, `cli.md`, `promptus.md`, `genai.md`) and apply to all work here. The non-obvious ones:

- **No `any`.** Use `unknown` plus narrowing. Note `noImplicitAny` is off in tsconfig and the eslint rule is disabled, so nothing enforces this — it is on you.
- **TypeScript 6 pins `strict: false` deliberately.** TS6 flipped `strict` to default `true`; this project runs the NestJS scaffold posture instead, so `tsconfig.json` sets `strict: false` and opts individual checks back in. `strictNullChecks`, `useUnknownInCatchVariables` and `strictFunctionTypes` are **on**; `strictPropertyInitialization` is **off** because Mongoose `@Prop` and GenAI request/response classes are populated by the framework, never in a constructor. Don't "tidy" this by deleting `strict: false` — that reintroduces 116 property-init errors.
- **Catch variables are `unknown`.** Use `getErrorMessage(e)` from `src/utils/error.utils.ts` rather than reaching for `e.message`.
- **Zod at every external boundary.** Third-party API responses and untrusted JSON start as `unknown`, get parsed by a Zod schema, and only then propagate as `z.infer<...>`. This is followed consistently in the Spotify/Qobuz/OpenSearch services; match it.
- **CLI commands are thin.** Parse options, call a service. All logic lives in `src/services/`. Register every command class in `src/cli/command.provider.ts` or it will not exist.
- **Gemini models**: use `gemini-3-flash-preview` / `gemini-3-pro-preview`. The 1.5 series and the legacy `@google/generative-ai` SDK are prohibited.

### Testing

Unit tests are largely bypassed in this project. `npm run build` is the real gate — **run it after any change** and make sure it compiles clean. Do not mark work done on a TypeScript error.

## Known drift

- `README.md` documents `npm run spotify:auth` and a `docker-compose.yml`; neither exists. Use `npm run cli -- spotify auth`.
- Session tokens are written to `.qobuz-session.json` / `.spotify-session.json` at the repo root (gitignored, and currently populated with live tokens).
