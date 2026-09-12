# The lighting designer

How a sentence like "make the living room cosy" becomes eleven Hue writes, and how the agent that
does it gets better at this household over time. Companion to [`promptus-architecture.md`](./promptus-architecture.md),
which explains the object model this is built on; this file only covers what is specific to lighting.

## 1. Where it sits

```
user ──socket──▶ ChatPromptusRequest (Giraffe)
                    │  tool: lighting_designer(natural_language_request)
                    ▼
                 LightingAgent.design()                      src/services/promptus/agent/lighting/
                    │  brief = rooms + live state + scenes + memory
                    │  DesignLightingRequest  (Flash, thinking HIGH, tool-bearing)
                    │     tools: hue_apply_lighting · hue_save_scene · hue_apply_scene · hue_read_lights
                    ▼
                 DomoticService ──▶ HueClientService ──HTTPS──▶ Hue bridge (CLIP v2)
                    │                                            src/services/domotic/
                    ├─ LightingSceneService   (Mongo: lighting_scene)
                    └─ LightingMemoryService  (Mongo: lighting_memory)
                                       ▲
                 LightingMemoryRequest ─┘  (Flash Lite, thinking LOW, structured) — runs after the answer
```

Three layers, each one ignorant of the ones above it:

- **`src/services/domotic/`** knows lights, rooms and the bridge. It has no idea a model exists.
  Everything a person could do from the CLI goes through it, and so does everything the model does.
- **`src/services/promptus/agent/lighting/`** is the designer: the prompt, the request shapes, the
  brief and the memory loop. It reaches the bridge only through `DomoticService`.
- **`ChatPromptusRequest`** knows one thing about lights: hand the whole request to `lighting_designer`
  and relay the answer. The four Hue tools are declared on `DesignLightingRequest` only, never on the
  chat, so the top-level model cannot set a light without the designer's knowledge of the rooms.

Same pattern as the disc jockey: a specialised agent behind one tool, `sessionId` threaded down so
its tool calls appear as children of the chat's thread in the app.

## 2. The room configuration

The bridge knows what a light is and what it is doing. It does not know which room it stands in,
where in the room, or what the household calls it. That lives in `files/hue-<room>.yaml`, one file
per room:

```yaml
room: Living Room
view: Overhead

grid: |
  [Top Left]                                     [Top Right]
       (花高)
      /      \                                    (Possums' shrine) --- (Lower div)
  (Flower)  (🌹中)
  ...
legend:
  花高: { id: "d182de0f-…", name: "花高", archetype: "table_shade" }
  Flower: { id: "08737482-…", name: "Flower lamp 🪔", archetype: "pendant_round" }
```

- **The yaml is the source; JSON is its rendering.** `DomoticService.getRoomConfig()` reads the files
  and returns `RoomConfig[]` (`room`, `slug`, `grid`, `lights[{label, id, name, archetype}]`).
  `npm run cli -- domotic rooms` prints it; `--write` drops it at `files/hue-rooms.json` for anything
  that wants a static copy. The designer is briefed from the live rendering on every request, so an
  edited yaml is picked up with no restart and no cache to clear.
- **The grid is for the model as much as for people.** It is passed verbatim as an overhead plan,
  and the prompt tells the model to read left, right, top, bottom and adjacency off it. "The lamps
  by the couch" is answerable only because the sketch is there. Draw new rooms the same way.
- **Labels are the tool vocabulary.** The `(…)` names on the plan are the `target` values every tool
  call uses. They resolve exactly first, then as a unique substring; an ambiguous label ("shrine"
  matches two lamps) is refused with the candidates listed, so the model corrects itself rather
  than lighting the wrong lamp.
- **Placement and bridge are reconciled, not trusted.** A light the bridge lists but no file places
  is still a light, shown under "Unplaced". A placement whose id the bridge no longer has is warned
  about and dropped.
- `hue-placement.util.ts` reads only `room:`, `grid: |` and the `legend:` block, line by line. No YAML
  library: the format is three keys and adding a dependency for it would put a supply-chain surface
  behind a floor plan. Anything after a legend entry's closing brace is ignored on purpose; the files
  are hand-written.

## 3. One request, end to end

`LightingAgent.design(request, ctx)`:

1. **Brief.** Four reads in parallel: room config, live light states (one bridge call), saved scenes,
   household memory. Rendered to text by `lighting-brief.util.ts` and placed in the *query*, in
   that order, with the request last. The system instruction (`design-lighting.prompt.ts`) never
   changes; everything that varies per request is in the query. That split is the same one
   `WhatIsPlayingRequest` makes and for the same reason: the instruction explains how to read a
   brief and stays constant, the brief is per request.
2. **Design.** `DesignLightingRequest` runs on `GEMINI_FLASH` at `ThinkingLevel.HIGH`. High because
   this is a small design problem — which room, which of eleven lamps, what layer each plays, what
   was said last time — and a wrong guess lights the bedroom at midnight. It is tool-bearing and
   has no structured response: the work is in the tool calls and the answer is two or three
   sentences for the user.
3. **Act.** The prompt asks for **one** `hue_apply_lighting` call carrying every light that changes,
   with `room` set. The handler validates the arguments with Zod (`LightingUpdateSchema`), resolves
   each target against the live pool, translates units, and writes them one at a time 100 ms apart
   (the bridge asks for at most ten light commands a second). The reply is pipe-separated, one line
   per light, `ok|label|what was set` or `failed|target|why`, so the model can fix the one entry that
   failed and resend only that light.
4. **Reply.** Prose, relayed verbatim by the chat. Labels, never ids; no Kelvin figures unless asked.
5. **Remember.** After the answer is handed back, the notebook is rewritten (§5). Not awaited.

### Units: what the model says and what the bridge gets

| Model writes | Bridge receives | Where |
| --- | --- | --- |
| `brightness: 35` | `dimming.brightness: 35` | as is |
| `kelvin: 2200` | `color_temperature.mirek: 455` | `kelvinToMirek`, clamped to the light's own `mirek_schema` |
| `color: "#ff8c00"` | `color.xy: {x, y}` | `hexToXy`, sRGB → Wide RGB D65 → xy; no gamut clip (the bridge clamps) |
| `effect: "candle"` | `effects_v2.action.effect` | as is; refused before the call if the light does not list it |
| `transitionMs: 2500` | `dynamics.duration: 2500` | as is |
| `on: true/false` | `on.on` | as is |

Two translations are not unit changes and are worth knowing:

- **A colour or a white written under a running effect stops the effect.** An effect owns the
  light's colour while it runs, so the write would otherwise be invisible. `toHueUpdate` adds
  `effect: no_effect` when the light currently runs one and the entry does not name an effect.
- **`color` wins over `kelvin`** when an entry carries both. The bridge keeps whichever is last in
  the body; resolving it here makes the outcome deterministic.

Nothing turns a light on implicitly except the CLI's `domotic effect`, which switches a lamp on so
the effect is visible. The designer is told to set `on` explicitly.

## 4. Scenes

"Save this as movie night" → `hue_save_scene`. Scenes are stored **resolved**: light ids and bridge
units, not labels and Kelvin. Recalling one (`hue_apply_scene`, or `domotic scenes --apply`) is a
replay with no model in the loop, and a renamed lamp does not break it. Saving over an existing
title replaces it — said twice, "remember this as cosy" means the second one.

Saving applies nothing. The prompt says so, and says to apply as well when the lights should change
now. The model is told never to save unless asked; a scene is a thing the household named, not a
by-product of every request.

Scenes are listed in the brief by title, room and description, so "put on movie night" is answered
by `hue_apply_scene` and an unknown name falls back to composing the lighting.

## 5. Memory: getting smarter by being corrected

The household does not want to explain "cosy" twice. `LightingMemory` is one document for the whole
house (`scope: household`, the only scope today) with two parts:

- **`summary`** — model-written prose, bounded at 1500 characters, grouped as preferences,
  corrections, vocabulary and habits. This is what the designer reads at the top of every brief,
  under "WHAT THE HOUSEHOLD HAS TAUGHT YOU", and the prompt says it outranks the model's own
  defaults.
- **`recent`** — the last twelve requests, oldest first, each with the tool calls it produced and the
  reply. The last six are rendered into the brief so the designer sees the sequence, and all twelve
  go to the summariser so it can tell a correction from a new request.

After every `design()` the agent queues `LightingMemoryRequest`: the previous summary, the recent
log, and the request just served (request, actions read back off the request's own `history` via
`describeActions`, reply). `GEMINI_FLASH_LITE`, `ThinkingLevel.LOW`, one structured field. Same
economics as `ChatTitleRequest`, and for the same reason: it runs after every request, beside the
user's path, never on it.

What the summariser is told matters more than the schema:

- rewrite the whole summary, do not append; keep every fact not contradicted;
- a correction *replaces* the preference it corrected ("40% was too bright; 20% was right");
- record what recurs or what was explicitly pushed back on; a one-off is not a preference;
- a failed request teaches nothing about taste;
- vocabulary is a first-class section: what "the mouse lamps" or "cosy" mean in this house.

Corrections reach the designer twice over. The chat prompt asks the Giraffe to pass along what the
user is reacting to ("they said the bedroom is too bright after you set it for reading"); the
designer prompt says a request like "too bright" is about the *current* state and the *previous*
request — adjust from what is, change nothing they did not complain about. The current state is in
the brief and the previous request is in the recent log, so both halves of that instruction are
answerable.

Mechanics worth knowing:

- Rewrites are chained on the agent (`memoryChain`), so two requests close together fold into the
  notebook in order and the second reads the first's summary rather than racing it.
- The chain is fire-and-forget in the chat. From the CLI it must be awaited — nest-commander closes
  the app, and with it the Mongo client, the moment a command's `run` returns — which is what
  `LightingAgent.settled()` is for and why `domotic ask` awaits it.
- `npm run cli -- domotic memory` prints the summary and the log; `--clear` forgets everything. A
  summary that has learnt something wrong is fixed by correcting the designer in conversation, or by
  clearing and starting over. There is no tool that edits it, deliberately: nothing a user types
  should rewrite the notebook directly.

## 6. The prompt, in short

`design-lighting.prompt.ts` has five parts, and the order is the order the model needs them in:
what it is given (the four brief sections and how to read the plan), how Hue lights work (units,
effects and their character, the effect-owns-colour rule, `on` being explicit), how to work (scope
→ design in layers → honour corrections → one call → scenes → reply), and a short list of nevers.

Two choices to defend if they are questioned:

- **No clarifying questions.** The prompt says to state a default instead. A lighting request is
  cheap to correct and expensive to interrupt; "I've dimmed the living room — say if you meant the
  bedroom" is a better experience than a question, and the memory turns the correction into a rule.
- **The living room is the default room, the bedroom is meant for sleep and night.** Stated in the
  prompt as a fallback *after* the memory, so a household that always means the bedroom teaches
  that once.

## 7. Verification

```bash
npm run cli -- domotic ask --brief x            # the exact brief the designer would get, as JSON
npm run cli -- domotic ask "make the living room cosy for the evening"
npm run cli -- domotic ask "a bit brighter, and no candle"
npm run cli -- domotic memory                   # what the two requests taught it
npm run cli -- promptus chat "make the lights cosy"   # through the Giraffe, to see the delegation
```

`ask` prints the tool trace the way `promptus chat` does. The first run above produced one
`hue_apply_lighting` call for nine lights: pendant off, shades at 25–35% around 2200 K, candle on
the shrine's lower bulb, play bars low and warm, and a two-and-a-half second fade — which is the
kind of layered answer the prompt asks for.

## 8. Not done yet

- **No snapshot and restore.** An effect owns brightness while it runs and `no_effect` leaves the lamp
  where the effect left it. A "put it back how it was" needs the state before the request, which the
  brief already holds — it is a matter of keeping it for one turn.
- **No Hue groups or native scenes.** Every write is per light. The bridge's own `grouped_light` and
  `scene` resources would let a room change in one command and would show in the Hue app; not used
  because the placement labels, not the bridge's rooms, are the vocabulary here.
- **Memory is per household.** A per-user layer (`scope: user:<id>`) can sit beside it when two
  people want different things from the same lamps.
- **The certificate check is off** in `HueClientService`. Pinning the Signify root and verifying the
  bridge id as CN is the proper form; the application key in the header is what authenticates today.
- **No event stream.** The brief reads the bridge on every request; the bridge's SSE
  `/eventstream/clip/v2` would keep a live picture and is what a "what changed" answer would need.
