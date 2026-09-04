---
name: promptus-prompt
description: Add or change a Gemini prompt in src/services/promptus — a new request/response pair, a new agent, or a new tool handler. Use whenever the task involves a prompt, a PromptusRequest, a responseSchema, an agent's wrapResponse, a ToolDeclaration, or Gemini context caching in this repo. Triggers on "add a prompt", "new agent", "new tool", "change the instruction", "the model is ignoring X".
---

# Adding a prompt to Promptus

The framework is described in [`doc/promptus-architecture.md`](../../../doc/promptus-architecture.md)
and [`doc/promptus-caching.md`](../../../doc/promptus-caching.md). Read the architecture doc's §5
(the four request shapes) before writing anything — the shape decides which of the steps below apply.

`npm run build` is the gate. Unit tests are bypassed in this project; do not report done on a TS error.

---

## Step 1 — Pick the shape

| If the prompt… | Shape | Consequences |
| --- | --- | --- |
| just needs an instruction and returns JSON | **Plain** | `context` = the prompt, `tools = []`, use `structuredResponse` |
| needs the model to call functions | **Tool-bearing** | populate `tools`, usually no `structuredResponse` |
| needs live web facts | **Grounded** | `grounded = true`, **`tools = []`**, **no `structuredResponse`**, answer in prose |
| rides on a large static payload sent many times | **Cached** | `context = ''`, instruction goes in the cache, **no tools, no grounding** |

Default to **Plain**. Only reach for Cached when the same large payload is about to be sent many
times in a row — see the caching doc §5.

## Step 2 — Pick the host agent

- User-facing, top level → `ChatPromptusRequest` in `promptus/request/chat.promptus.request.ts`.
- Music curation / playlists → `DiscJockeyAgent`.
- Database query building → `QueryDatabaseAgent`.
- Library enrichment → `EnrichAgent`.
- None fit → new agent (Step 6). If unsure, **ask the user** rather than guessing.

---

## Step 3 — Write the three files

Under `src/services/promptus/agent/<agent>/`:

### `request/<action>.prompt.ts`

```ts
export const someActionPrompt = `
# System Role
...

## Data Formats You Will Receive
...

## Few-Shot Example
...
`;
```

Keep controlled vocabulary out of the literal — import it from `src/lexic/songs.description.ts`
(`SONGS_GENRE_DESCRIPTION`, `SONGS_EMOTIONS_DESCRIPTION`, `SONGS_PACE_DESCRIPTION`) so every prompt
stays in the same closed set.

### `request/<action>.request.ts`

```ts
import { GEMINI_FLASH } from '../../../config';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { SomeActionResponse } from '../response/some-action.response';
import { someActionPrompt } from './some-action.prompt';

export class SomeActionRequest extends PromptusRequest<SomeActionResponse> {
  public tools: ToolDeclaration[] = [];
  public config: Partial<GenerateContentConfig> = {};
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = GEMINI_FLASH;
  private readonly _role: RequestRole = 'user';
  private readonly _context = someActionPrompt;
  private readonly _query: string;

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: 'What this field means, in a full sentence.',
          items: { type: 'STRING' },
        },
      },
      propertyOrdering: ['items'],
      required: ['items'],
    },
  };

  get model(): string { return this._model; }
  get role(): RequestRole { return this._role; }
  get context(): string { return this._context; }
  get query(): string { return this._query; }

  constructor(query: string) {
    super();
    this._query = query;
  }
}
```

Model ids come from `promptus/config.ts` only — `GEMINI_FLASH`, `GEMINI_FLASH_LITE`, `GEMINI_3_FLASH`.
The 1.5 series and `@google/generative-ai` are prohibited.

Write real `description` strings on every schema property. They are instructions, not annotations,
and for a cached request they are most of what steers the model.

### `response/<action>.response.ts`

```ts
import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const schema = z.object({
  items: z.array(z.string()).default([]),
});

export class SomeActionResponse extends PromptusResponse {
  /** Empty rather than null so callers iterate unconditionally. */
  readonly items: string[] = [];

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

Strip the ```` ```json ```` fences even with `responseMimeType: 'application/json'` — the model still
emits them. Default fields to empty, never null. Throw on unparsable, unless the call is a
best-effort side path that must degrade instead of failing its caller — then return null and comment
why (`AlbumCoverResponse` is the precedent).

A prose response subclasses with an empty body and the caller reads `this.text`.

---

## Step 4 — Wire `wrapResponse` (do not skip)

In the host agent:

```ts
if (request instanceof SomeActionRequest) {
  return new SomeActionResponse(response) as ReqType;
}
```

**A request class with no `wrapResponse` branch compiles cleanly and throws at runtime.** This is the
most common way to break this layer.

Then add the method that runs it:

```ts
async someAction(query: string, sessionId?: string) {
  return await this.generate(new SomeActionRequest(query), sessionId);
}
```

---

## Step 5 — Only if the model should call it: the tool

1. **Definition** — `tools/definition/<domain>-tools.definition.ts`, a static `ToolDeclaration` on a
   private-constructor class, `as const`.
2. **Handler** — `tools/handler/<domain>/<action>.handler.ts` implementing `ToolHandler`. Set
   `readonly name = SomeToolsDefinition.someTool.name` — reference it, never retype the string.
3. **Validate `args`.** It is untrusted model output: narrow with a type guard
   (`isNaturalLanguageRequest`) or Zod.
4. **Return errors, never throw.** `{ type: 'string', name: this.name, message: '...' }` lets the
   model self-correct; a throw aborts the whole `generate` loop.
5. **Register** in `ToolsService` — constructor for stateless handlers, `initialiseAgent` for
   agent-delegating ones.
6. **Add the declaration to the parent request's `tools` array.** Missing this means the handler
   exists and is never called.

---

## Step 6 — Only if it needs a new agent

```
src/services/promptus/agent/<name>/
├── <name>.agent.ts
├── request/
└── response/
```

```ts
export class SomeAgent extends Agent {
  name = 'SomeAgent';
  protected readonly logger = new Logger(this.name);

  constructor(apiKey: string, toolService: ToolsService, eventEmitter: EventEmitter2) {
    super();
    this.initialiseAgent(apiKey, toolService, eventEmitter);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof SomeActionRequest) return new SomeActionResponse(response) as ReqType;
    throw new Error('Unsupported request in SomeAgent.wrapResponse: ' + request.constructor.name);
  }
}
```

`initialiseAgent` is what builds the client — an agent that skips it throws on first use. Agents are
plain-`new`ed (not Nest providers), so construct it wherever it is owned: `ToolsService.initialiseAgent`
for a chat-reachable agent, or the owning service's constructor for a CLI/scheduler one.

---

## Step 7 — Batch work

Use `agent.parallelGenerate(requests, concurrency)`. Before each request it calls
`ThrottleHandler.acquire`, which blocks until the request's **model** has room in both its
requests-per-minute and tokens-per-minute allowance. The buckets are process-wide and keyed by
model — the quota belongs to the API key, not the agent — and the figures live in
`MODEL_RATE_LIMITS` in `promptus/config.ts`; add a row there when you introduce a model. Every
`generate` call (throttled or not) also increments a per-model, per-day counter in Redis and logs the
share of the daily quota at each 10% step. That one is displayed, never enforced.

**The result array is sparse.** A failed request is logged and swallowed, leaving a hole:

```ts
const responses = await this.agent.parallelGenerate(requests, 5);
for (const [index, item] of items.entries()) {
  const response = responses[index];
  if (!response) continue;   // failed — leave `item` unprocessed so the next pass retries it
  ...
}
```

Build `requests` from the same array you zip back against. `getPopulatedSongsByIds` uses `$in` and
does not preserve input order.

---

## Step 8 — Verify

```bash
npm run build
```

Then exercise it. `npm run cli -- promptus chat` logs every tool call with its arguments
(`ToolsService.proceedFunctionCall` at debug level), which is the fastest way to see what the model
actually did.

---

## When the model seems to ignore the instruction

Work down this list before rewriting the prompt:

1. **Is the request cached?** Then `context` is inert and `tools`/`grounded` are dropped. The
   instruction lives in the cache — see the caching doc §1–2.
2. **Is a stale cache in the way?** `CacheHandler.cache` get-or-creates by name and never compares
   content, so an edited prompt or profile changes nothing until
   `npm run cli -- promptus clear-cache`.
3. **Is `wrapResponse` returning the right class?** The phantom type is compile-time only.
4. **Is it grounded with `tools` or a `responseSchema` set?** Gemini rejects both combinations.
5. **Are the schema `description` strings actually written as instructions?** For a cached request
   they carry most of the weight.
6. **Does the cache's `model` match the request's `model`?** A mismatch fails at call time, not at
   compile time.
