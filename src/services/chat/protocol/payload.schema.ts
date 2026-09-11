import { z } from 'zod';
import { PlaylistItemSchema, SourceNameSchema } from './action.schema';

/**
 * The song a `now_playing` or `mpc` payload describes.
 *
 * A flattened projection of `PlaylogService`'s `NowPlaying` snapshot — the same one the /vibing-on
 * page renders — so the television and the phone can never disagree about what is playing.
 */
export const NowPlayingSchema = z.object({
  songId: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  year: z.string().optional(),
  genre: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  coverUrl: z.string().optional(),
  /** The source MPD is actually playing from, not the best available one. */
  source: SourceNameSchema.optional(),
  /**
   * The id within that source, which is what turns a share into a link rather than bare text.
   *
   * Only the server can know it — the phone sees a title and an artist, not which `SongSource`
   * the daemon resolved to — and it is absent for a local file, which has no public page.
   */
  sourceId: z.string().optional(),
  bitrate: z.number().int().nonnegative().optional(),
  sampleRate: z.number().int().nonnegative().optional(),
  isHighRes: z.boolean().optional(),
  isCdQuality: z.boolean().optional(),
  bitDepth: z.number().int().nonnegative().optional(),
  /** The codec ffprobe reported, falling back to the file extension for the unenriched bulk. */
  encoding: z.string().optional(),
  bpm: z.number().nonnegative().optional(),

  // What the song *is*, as opposed to how it was encoded. Every one of these comes out of the
  // enrichment pass and is drawn from the closed vocabulary in `src/lexic/songs.description.ts`,
  // so a client may show them verbatim without worrying what it will get.
  category: z.string().optional(),
  emotion: z.string().optional(),
  pace: z.string().optional(),
  label: z.string().optional(),
  country: z.string().optional(),
  language: z.string().optional(),

  /**
   * The disc jockey's markdown narration of this track, and the artist blurb behind it.
   *
   * Both arrive **late**. The snapshot is published the moment the song changes and the commentary
   * is a model call that lands seconds later on its own event, so a client has to expect this field
   * to appear on a later revision of an envelope it already drew. Neither is ever generated while
   * nothing is watching — see `PlaylogService`'s audience count.
   */
  artistIntro: z.string().optional(),
  description: z.string().optional(),
});
export type NowPlayingPayload = z.infer<typeof NowPlayingSchema>;

/**
 * One entry of the "just played" strip, mirroring `RecentlyPlayed` on the /vibing-on side.
 *
 * Deliberately thin. This is the playlog reaching back past the current MPD queue, so there is no
 * queue entry to address and nothing here is actionable — it answers "what was that one before?"
 * and nothing else.
 */
export const RecentlyPlayedSchema = z.object({
  title: z.string(),
  artist: z.string(),
  coverUrl: z.string().optional(),
});

/**
 * The floating transport bar, as a message.
 *
 * Session-scoped (`chatId: null`) and **ephemeral**: never persisted, regenerated from Redis when
 * a session goes active, so a reconnect gets a fresh bar rather than a replayed one.
 *
 * The bar's buttons are the envelope's `actions`, not a fixed set on the client — which is the
 * whole point of modelling the transport as a message. Extending it later means adding action
 * kinds and fields here, not inventing a second protocol.
 *
 * `elapsedMs` is a **sample**, not a clock. The client interpolates from `sampledAt`; the server
 * only republishes when something other than elapsed changed, plus a slow drift correction. Emit
 * on every poll instead and `rev` climbs forever for a track nobody touched.
 *
 * `volume` and `modes` are carried from day one because `status` already reports them. Their
 * *controls* are deferred — `setvol`, `repeat`, `random`, `single` and `consume` each need an MPD
 * request/response pair that does not exist yet — so the bar displays them and gains buttons when
 * those pairs land.
 */
export const MpcPayloadSchema = z.object({
  type: z.literal('mpc'),
  state: z.enum(['play', 'pause', 'stop', 'unknown']),
  song: NowPlayingSchema.nullable(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** Epoch ms the sample was taken; the client interpolates elapsed forward from here. */
  sampledAt: z.number().int(),
  volume: z.number().int().min(0).max(100).nullable(),
  modes: z.object({
    repeat: z.boolean(),
    random: z.boolean(),
    single: z.boolean(),
    consume: z.boolean(),
  }),
  queue: z.object({
    position: z.number().int().nonnegative().nullable(),
    length: z.number().int().nonnegative(),
  }),
  /**
   * What played before this, newest first. On the bar rather than on the song, because it is the
   * player's history and not a property of the track — a `now_playing` answer in a timeline has no
   * business carrying one.
   */
  recent: z.array(RecentlyPlayedSchema).default([]),
});
export type MpcPayload = z.infer<typeof MpcPayloadSchema>;

/** System events that are about the connection or the player rather than about a conversation. */
export const SystemEventSchema = z.enum(['session_resumed', 'playback_started', 'playback_stopped', 'source_upgraded', 'chat_created']);
export type SystemEvent = z.infer<typeof SystemEventSchema>;

/**
 * Everything the server can say, discriminated on `type`.
 *
 * A client that does not know a `type` renders the envelope's `copyText` in a plain bubble rather
 * than throwing — which is why `copyText` is required on the envelope. Two repos deploy
 * independently; without that rule a server deploy blanks out every phone that has not updated.
 */
export const ChatPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    format: z.enum(['markdown', 'plain']).default('markdown'),
    text: z.string(),
  }),

  /**
   * The grouping container. Children point at it through `parentId`, which is the one mechanism
   * behind both the thought log and any future sub-thread — nested agents nest for free because
   * `openThread` hands back the child context that gets threaded down.
   */
  z.object({
    type: z.literal('thread'),
    label: z.string(),
    agent: z.string().optional(),
    /** Shown in place of the children once the thread is complete and collapsed. */
    summary: z.string().optional(),
    childCount: z.number().int().nonnegative().default(0),
    collapsedByDefault: z.boolean().default(true),
  }),

  z.object({
    type: z.literal('thought'),
    agent: z.string(),
    label: z.string(),
    detail: z.string().optional(),
  }),

  z.object({
    type: z.literal('tool_call'),
    callId: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),

  z.object({
    type: z.literal('tool_result'),
    callId: z.string(),
    tool: z.string(),
    ok: z.boolean(),
    summary: z.string(),
  }),

  z.object({
    type: z.literal('playlist'),
    title: z.string().optional(),
    /**
     * Whether the queue watcher is still reconciling this message. Only the newest playlist per
     * chat stays live — otherwise every playlist ever sent would re-broadcast on every queue
     * change. It never means "Redis was missing": Redis is required at boot.
     */
    live: z.boolean().default(false),
    /** The MPD queue version this snapshot was taken at, for debugging a stale-looking bar. */
    mpdVersion: z.number().int().nonnegative().optional(),
    items: z.array(PlaylistItemSchema),
  }),

  /** A timeline *answer* about what is playing, as opposed to the ambient `mpc` control surface. */
  z.object({ type: z.literal('now_playing'), song: NowPlayingSchema }),

  MpcPayloadSchema,

  z.object({
    type: z.literal('system'),
    event: SystemEventSchema,
    text: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),

  /** Diagnostics only. `level` on the envelope is orthogonal — any type can be debug-level. */
  z.object({
    type: z.literal('log'),
    scope: z.string(),
    text: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),

  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().default(false),
  }),
]);

export type ChatPayload = z.infer<typeof ChatPayloadSchema>;
export type ChatPayloadType = ChatPayload['type'];

/** Narrowing helper, so a consumer can pull one member out of the union by its discriminator. */
export type PayloadOf<T extends ChatPayloadType> = Extract<ChatPayload, { type: T }>;
