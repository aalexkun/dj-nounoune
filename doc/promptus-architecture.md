# Promptus architecture

How the LLM layer in `src/services/promptus/` is put together, and which contract each class has to
satisfy. Read this before adding an agent, a request or a tool. The caching semantics are subtle
enough to live in their own file: [`promptus-caching.md`](./promptus-caching.md).

The authoritative behavioural specs remain `.agent/rules/promptus.md` and `.agent/rules/genai.md`.
This document describes the *object model* those rules operate on.

---

## 1. Four object families

| Family | Base | Lives in | Answers |
| --- | --- | --- | --- |
| **Agent** | `Agent` (abstract) | `agent.ts`, `agent/<name>/` | Who is talking to Gemini, and what loop are they running? |
| **Request** | `PromptusRequest<TResponse>` (abstract, generic) | `<agent>/request/`, `promptus/request/` | What exactly is sent — model, instruction, tools, schema, history? |
| **Response** | `PromptusResponse` | `<agent>/response/`, `promptus/response/` | How is one raw `GenerateContentResponse` turned into a typed object? |
| **Tool** | `ToolHandler` (interface) + `ToolDeclaration` | `tools/handler/`, `tools/definition/` | What can the model *do*, and who executes it? |

The whole design turns on one idea: **an agent is stateless, a request is not.** Conversation
history, the cache handle, the tool list and the response schema all live on the request object.
That is why sub-agents can be plain-`new`ed instead of injected, and why the same agent instance can
serve concurrent sessions without interfering with itself.

---

## 2. `Agent` — the thinking loop

`src/services/promptus/agent.ts`

```
initialiseAgent(apiKey, toolService, eventEmitter)
  └─ constructs GoogleGenAI, ThrottleHandler, CacheHandler
generate(request, sessionId?)          → the function-calling loop, max 10 iterations
parallelGenerate(requests, limit)      → N workers over a shared index, throttled per request
wrapResponse(request, response)        → abstract; the instanceof chain each agent implements
```

### Contract for a subclass

1. Extend `Agent`, declare `name`, declare `protected readonly logger = new Logger(this.name)`.
2. Call `super()` **and** `this.initialiseAgent(...)` in the constructor. `initialiseAgent` is what
   creates the client — an agent that skips it throws on first use.
3. Implement `wrapResponse` as an `instanceof` chain over that agent's own request classes, ending
   in a `throw`. This is the only place the phantom type is honoured at runtime; see §3.

### What `generate` does per iteration

Calls `request.getGeneratedContent()`, counts tokens, calls Gemini. If the response carries
`functionCalls`, each one is dispatched through `ToolsService.proceedFunctionCall`, the results are
pushed back onto the request's history as one `MODEL` content, and the loop goes round again.
Otherwise it hands the response to `wrapResponse` and returns. Ten iterations without a final answer
throws `generate maxThinkingLoop`.

Consequences worth knowing:

- **History accumulates on the request.** Every candidate content is appended via `request.addHistory`.
  A request object is single-use; do not resubmit one.
- **A tool that returns an error string keeps the loop alive**, which is the point — the model can
  self-correct. A tool that *throws* propagates out of `generate` and kills the call.
- **`sessionId` threads all the way down.** When present, the agent emits `chat.status.response` on
  entry and `chat.message.response` per function call, so nested sub-agents report into the same
  WebSocket room as the top-level chat.

### `parallelGenerate` returns a **sparse** array

```ts
const results: ReqType[] = new Array(requests.length);
// worker:  try { results[index] = await this.generate(request); } catch (e) { this.logger.error(e); }
```

A failed request is logged and swallowed, leaving a hole. Any caller zipping results back to inputs
by index must guard `if (!response) continue;` — and that guard is usually also the right retry
policy, since the corresponding item stays unprocessed.

---

## 3. `PromptusRequest<TResponse>` — the phantom type

`src/services/promptus/promptus.request.ts`

```ts
export abstract class PromptusRequest<TResponse> {
  declare readonly _responseType: TResponse;   // never assigned; exists only for inference
  ...
}
```

`TResponse` is never constructed by the base class. It exists so that

```ts
const response = await agent.generate(new PostFilteringRequest(prompt));
//    ^? PostFilteringResponse
```

types correctly at the call site. The runtime half of that promise is `wrapResponse`: if an agent's
`instanceof` chain returns the wrong class, the compiler will not catch it. **Adding a request class
without adding its `wrapResponse` branch compiles fine and throws at runtime** — that is the single
most common way to break this layer.

### Abstract members every request must declare

| Member | Notes |
| --- | --- |
| `model` | From `promptus/config.ts` (`GEMINI_FLASH`, `GEMINI_FLASH_LITE`, `GEMINI_3_FLASH`). Never a raw id. |
| `context` | The system instruction text. See the delivery matrix in §5 — it is not always sent. |
| `query` | The user turn. Seeds `history` when history is empty. |
| `role` | `'user'` or `'model'`. |
| `cache?` | A `CachedContent` handle. Setting it changes the request shape entirely — see §5. |
| `structuredResponse?` | `responseMimeType` + `responseSchema`. Merged in unconditionally. |
| `config` | `Partial<GenerateContentConfig>` — thinking level, etc. |
| `tools` | `ToolDeclaration[]`. |
| `history` | `Content[]`. Persisted per chat in the `Chat` document for the top-level request. |
| `grounded` | Defaults to `false`. Opt-in Google Search. |

The prevailing style is a private backing field plus a getter (`_model` / `get model()`), which keeps
the value immutable from outside. Some newer requests use plain public fields instead. Both compile;
match the file you are working next to.

### `initialiseGenAiRequest` — the one method that decides everything

```
history empty?          → seed it with { role, parts: [{ text: query }] }
cache?.name set?
  ├─ yes → config.cachedContent = cache.name        ← systemInstruction, tools and grounded are ALL skipped
  └─ no  → config.systemInstruction = contextContent
           config.tools = [{ functionDeclarations: tools }]   (when tools.length > 0)
           config.tools += { googleSearch: {} }               (when grounded)
structuredResponse set?  → merged into config, regardless of the branch above
```

`contextContent` is a getter over `context`, and it is read in exactly two places: the
`systemInstruction` line above, and `ThrottleHandler.calculateTokenCost` for cost estimation. There
is no third path.

---

## 4. `PromptusResponse` — the parse boundary

`src/services/promptus/promptus.response.ts`

The base constructor inspects `candidates[0].finishReason` and **throws** on `MAX_TOKENS`, `SAFETY`,
`RECITATION`, `OTHER`, `MALFORMED_FUNCTION_CALL` and on an absent reason. Only `STOP` and
`FINISH_REASON_UNSPECIFIED` return normally. So constructing a response is itself a validation step,
and any subclass work happens after that gate has passed.

House style for a structured subclass — see `PostFilteringResponse`, `GenerateQueryWithCacheResponse`:

```ts
const schema = z.object({ items: z.array(z.string()).default([]) });

export class XResponse extends PromptusResponse {
  readonly items: string[] = [];            // empty, not null, so callers iterate unconditionally

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        this.items = schema.parse(JSON.parse(cleanJson)).items;
      } catch (e: unknown) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${cleanJson}`);
      }
    }
  }
}
```

Three conventions in there that are load-bearing:

- **Strip the fences even with `responseMimeType: 'application/json'`.** The model still wraps output
  in ```` ```json ```` often enough to matter.
- **Default to empty, never null.** Every consumer iterates without a null check.
- **Throw on unparsable — except where a failure must degrade.** `AlbumCoverResponse` deliberately
  inverts this and returns `null`, because it runs beside the now-playing commentary and must not
  fail the whole enrichment. Make that choice explicitly and comment it.

Prose responses (`MusicTalkResponse`, `ChatPromptusResponse`, `WhatIsPlayingResponse`) subclass with
an empty body and read `this.text`.

---

## 5. The four request shapes

The shape is decided by `cache` and `grounded`, and it silently governs what actually reaches Gemini.
This table is the thing to check first when a request "ignores its instructions".

| Shape | `context` delivered as | `tools` | `structuredResponse` | `grounded` |
| --- | --- | --- | --- | --- |
| **Plain** | `config.systemInstruction` | sent | sent | — |
| **Tool-bearing** | `config.systemInstruction` | sent as `functionDeclarations` | usually omitted | — |
| **Grounded** | `config.systemInstruction` | **must be `[]`** — Gemini rejects both | **must be undefined** — Gemini rejects both | `googleSearch` appended |
| **Cached** | **not sent from the request** — it travels with the cache, see [`promptus-caching.md`](./promptus-caching.md) | **silently dropped** | sent | **silently dropped** |

Examples: plain → `PostFilteringRequest`. Tool-bearing → `WhatIsPlayingRequest`, `ChatPromptusRequest`.
Grounded → `MusicTalkRequest`, `AlbumCoverRequest`, `ArtistPerformanceRequest`. Cached →
`EnrichMetadataRequest`, `GenerateQueryWithCacheRequest`.

The three "silently dropped" cells have no runtime warning. A cached request that declares `tools`
compiles, runs, and never gets a function call.

---

## 6. Tools

### Two halves, kept in different folders

- **Definition** (`tools/definition/<domain>-tools.definition.ts`) — a `ToolDeclaration` static on a
  private-constructor class, declared `as const`. This is the schema the model reads.
- **Handler** (`tools/handler/<domain>/<action>.handler.ts`) — implements `ToolHandler`. Its `name`
  must be `SomeToolsDefinition.someTool.name`, referenced rather than retyped, or the registry lookup
  silently misses.

### Handler contract

```ts
async execute(args: unknown, sessionId?: string): Promise<FunctionCallResult>
```

- `args` is untrusted model output. Narrow it with a type guard (`isNaturalLanguageRequest`) or Zod.
- **Return errors, never throw.** A `FunctionCallResult` whose `message` describes the failure lets
  the model retry or explain; a throw aborts the whole `generate` call.
- Two result shapes: `{ type: 'string', name, message }` and `{ type: 'playlist', cache, description }`.
  The playlist shape hands a Redis key to `start_playback` instead of shipping the songs through the
  context window.

### `ToolsService` — the registry, and the deliberate cycle break

`Map<name, ToolHandler>` filled in two passes:

- **Constructor** — stateless handlers (MPD, Mongo distributions, Qobuz, YouTube).
- **`initialiseAgent(apiKey, eventEmitter)`** — agent-delegating handlers. Agents need `ToolsService`,
  and `ToolsService` needs agents; this second pass is what breaks the cycle. It is called from
  `PromptusService`'s constructor, not by Nest.

The same avoidance shows up again with `setNowPlayingSource`: `PlaylogService` registers itself into
`ToolsService` on module init rather than being injected, so `current_song` can answer from the
playlog snapshot without closing the loop.

### Agents as tools

`tools/handler/agent/` holds handlers whose only job is to call a sub-agent. That gives three levels:

```
ChatPromptusRequest ──tool──▶ DiscJockeyAgent ──tool──▶ QueryDatabaseAgent
```

To add one: build the handler around the sub-agent, register it in `initialiseAgent`, and add the
declaration to the parent request's `tools` array. Missing the last step means the handler exists and
is never called.

---

## 7. Invariants

1. **Never construct a `PromptusRequest` subclass without a `wrapResponse` branch** in the agent that
   will run it. Compiles; throws at runtime.
2. **A cached request cannot use tools or grounding**, and its `context` field is inert. See
   [`promptus-caching.md`](./promptus-caching.md).
3. **A grounded request must declare `tools = []` and no `structuredResponse`.** Gemini rejects both
   combinations.
4. **Model ids come from `promptus/config.ts`.** The 1.5 series and the legacy
   `@google/generative-ai` SDK are prohibited.
5. **Requests are single-use.** `generate` mutates `history`.
6. **`parallelGenerate` results are sparse.** Guard for holes.
7. **Handlers return errors as results, never throw.**
8. **The controlled vocabulary lives in `src/lexic/songs.description.ts`.** Extend it there so every
   prompt that renders it stays in the same closed set.

---

## 8. Map of the directory

```
src/services/promptus/
├── agent.ts                     Agent base: loop, throttle, cache handles
├── promptus.request.ts          PromptusRequest base + initialiseGenAiRequest
├── promptus.response.ts         PromptusResponse base + finishReason gate
├── promptus.service.ts          Root agent (chat entry point); calls ToolsService.initialiseAgent
├── config.ts                    Model aliases
├── tools.service.ts             Handler registry, cycle break
├── handler/
│   ├── cache.handler.ts         get-or-create CachedContent by displayName
│   └── throttle.handler.ts      per-model RPM + TPM buckets (enforced), RPD count in Redis (displayed); limits in config.ts
├── request/ · response/         Requests owned by PromptusService itself
├── agent/<name>/
│   ├── <name>.agent.ts
│   ├── request/<action>.request.ts + <action>.prompt.ts
│   └── response/<action>.response.ts
└── tools/
    ├── definition/<domain>-tools.definition.ts
    └── handler/<domain>/<action>.handler.ts
```

`ChatTitleAgent` under `agent/chat-title/` is entirely commented out. Dead code — do not use it as a
template.
