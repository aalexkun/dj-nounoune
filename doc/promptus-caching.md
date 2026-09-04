# Promptus context caching

Gemini context caching is how this project ships large, static grounding data — the database profile,
the enrichment taxonomy — without paying for it on every call. It also changes the shape of the
request in ways that are not obvious from the request class. Read this alongside
[`promptus-architecture.md`](./promptus-architecture.md) §5.

---

## 1. The instruction travels with the cache, not with the request

This is the rule that governs everything else.

`PromptusRequest.initialiseGenAiRequest` builds the outbound config as an either/or:

```ts
if (this.cache?.name) {
  this.genaiRequest.config['cachedContent'] = this.cache.name;
} else {
  this.genaiRequest.config['systemInstruction'] = { parts: [{ text: this.contextContent }] };
  // ... tools, grounding
}
```

So for a cached request the `context` field is not sent, and neither are `tools` nor `grounded`.
That is not instruction loss — **the instruction moves to the cache object**, which Gemini applies to
every request that references it. A `CachedContent` carries two instruction channels, and this
project uses both:

| Channel | Set via | Reaches the model as |
| --- | --- | --- |
| **Cached content** | the uploaded file named by `ReadonlyAgentCache.file` | a `user` turn prepended to the conversation |
| **Cached system instruction** | `ReadonlyAgentCache.cacheInstruction` | the request's system instruction |

Both are fixed at cache-creation time by `CacheHandler.cache`:

```ts
return await this.client.caches.create({
  model: cacheSetting.model,
  config: {
    displayName: cacheSetting.name,
    contents: createUserContent(createPartFromUri(existingFile.uri, existingFile.mimeType)),
    systemInstruction: cacheSetting.cacheInstruction || '',
  },
});
```

**Setting an instruction on the cache is sanctioned, not a workaround.** The installed SDK types it
directly — `CreateCachedContentConfig` (`node_modules/@google/genai/dist/genai.d.ts`) declares
`systemInstruction?: ContentUnion` *("Developer set system instruction")* alongside `contents`,
`tools`, `toolConfig`, `ttl` and `expireTime`. What Gemini rejects is a `systemInstruction` on the
**generateContent request** while `cachedContent` is set — which is precisely the case
`initialiseGenAiRequest`'s if/else already prevents. Cache-side, it is a first-class field.

The field is named `cacheInstruction` precisely to keep it apart from the request's own `context`
— which a cached request never sends — and from the `systemInstruction` key of the outbound request
config, which is what it becomes.

`ReadonlyAgentCache` (in `agent.ts`) is the descriptor that carries all of it:

```ts
type AgentCache = {
  name: cacheName;                 // displayName, and the file's resource name
  file: `files/${cacheName}`;      // local path written by FileService.saveFile
  fileMineType?: string;
  model: string;                   // MUST equal the request's model
  cacheInstruction: string;
  cacheContent: CachedContent | undefined;   // the only mutable field
};
```

---

## 2. How the two existing caches are wired

### `enrich-instruction` — instruction as cached **content**

`src/services/enrich/enrich.service.ts`

```ts
await this.fileService.saveFile(this.cacheName, enrichMetadataCachePrompt);  // the taxonomy prompt
const cacheSettings: ReadonlyAgentCache = {
  name: this.cacheName,
  file: `files/${this.cacheName}`,
  model: template.model,
  cacheInstruction: '',
  ...
};
```

The enrichment instruction *is* the cached file. `EnrichMetadataRequest` states this explicitly and
leaves its own context empty:

```ts
private readonly _context = ''; // This will be cached prior to the request
```

That comment is the pattern to copy: **when a request is cached, its `context` is `''` and the
instruction is written into the cache file.**

### `dj-nounoune-cache` — data as cached content, prompt as cached instruction

`src/services/promptus/agent/disc-jockey/disc-jockey.agent.ts`

```ts
protected cache: ReadonlyAgentCache = {
  name: 'dj-nounoune-cache',
  file: `files/dj-nounoune-cache`,
  model: GEMINI_FLASH,
  cacheInstruction: generateQueryWithCache,   // the query generator's prompt
  cacheContent: undefined,
};

// in createPlaylist:
const dbProfile = await this.profilerService.getDatabaseProfileForPrompt();
await this.fileService.saveFile(this.cache.name, dbProfile);
const cacheContent = await this.cacheHandler.cache(this.cache);
```

Here both channels are used, each for what it is. The cached **file** is the database profile —
schema with each field's description, cardinality, completeness, the song lexic — which is data. The
cached **instruction** is `generateQueryWithCache`, the prompt that teaches the three query branches,
which is instruction. `GenerateQueryWithCacheRequest` accordingly sets `context = ''` and says why;
its `structuredResponse` descriptions are field specs on top of that prompt, not a substitute for it.

This cache is referenced by exactly one request, so nothing else inherits the prompt. Editing either
the prompt or anything the profiler renders takes effect only after §3.

## 3. Caches are sticky — clear them or your edit does nothing

`CacheHandler.cache` is a get-or-create on **name**, at two levels, and neither compares content:

```ts
let existingFile = cachedFiles.page.find((f) => f.name === cacheSetting.file);
if (!existingFile) { existingFile = await this.client.files.upload({ ... }); }
...
const existingCacheContent = cachedContents.find((c) => c.displayName === cacheSetting.name);
if (existingCacheContent) { return existingCacheContent; }
```

So an edited prompt, an edited taxonomy, or a freshly regenerated database profile is **ignored**
while a cache or an uploaded file of the same name still exists remotely. This is the usual
explanation for "I changed the prompt and nothing changed".

```bash
npm run cli -- promptus clear-cache          # every cache, by displayName
npm run cli -- music enrich --clear-cache    # just enrich-instruction
```

`clearCache(name)` deletes both the uploaded `files/*` entries and the `cachedContents` whose
`displayName` matches, so the next run re-uploads and re-creates.

Also note `DiscJockeyAgent.createPlaylist` re-creates its cache only when `cacheContent` is missing or
`expireTime` has passed. The in-memory handle outlives an edit too.

---

## 4. Constraints

1. **Model match.** `cacheSetting.model` must equal the request's `model`. A mismatch is a
   `PERMISSION_DENIED` / not-found at call time, not a compile error.
2. **No tools — in this codebase.** `tools` is only attached in the non-cached branch, so a cached
   request that declares tools will never receive a function call, silently. The API itself is less
   strict: `CreateCachedContentConfig` accepts `tools` and `toolConfig`, so tools *can* be baked into
   the cache. Nothing here does that yet, and `ReadonlyAgentCache` has no field for it.
3. **No grounding.** `grounded` is likewise only honoured in the non-cached branch.
4. **`structuredResponse` still works.** It is merged in outside the if/else, so a cached request can
   and should use a `responseSchema`.
5. **Minimum size.** Gemini rejects cached content below a model-dependent token floor. Small
   instructions (a few hundred tokens) are not worth caching — give the request a normal `context`
   and no cache.
6. **TTL.** Caches expire. `expireTime` is checked by `DiscJockeyAgent`; a new cache is created on
   demand when it has lapsed.

---

## 5. Choosing: cache or plain context?

| | Use a cache | Use plain `context` |
| --- | --- | --- |
| Instruction size | large and static (DB profile, full taxonomy) | anything under a few thousand tokens |
| Reuse | same payload across many calls | per-call |
| Needs tools or grounding | **no** — incompatible | yes |
| Cost of a change | requires `clear-cache` | immediate |

Default to plain `context`. Reach for a cache only when the same large payload is about to be sent
many times in a row — which in practice means the enrichment batch loop and the playlist query
generator, and nothing else so far.
