import { z } from 'zod';
import { SOURCE_TYPES } from '../../../schemas/source.schema';

/**
 * What a client may be offered on a message, and on the addressable elements inside one.
 *
 * The union is **closed and versioned**: the server declares which actions exist on a given
 * message and binds their parameters, the client owns icon, label, ordering and confirmation
 * keyed on `kind`. That split is what lets a new action on an existing kind ship without an APK,
 * and what keeps a forged `chat:action` frame from reaching a handler — the gateway re-derives
 * the declared set before executing anything.
 *
 * The client parses this array **element-wise and leniently**: a `kind` it does not know is
 * dropped, never fatal. A discriminated union rejects an unknown discriminator, so parsing the
 * whole array strictly would let a newer server blank out every action on an older app.
 */
export const SourceNameSchema = z.enum(SOURCE_TYPES);
export type SourceName = z.infer<typeof SourceNameSchema>;

/**
 * A native share payload, built server-side from the `SongSource` actually playing.
 *
 * `url` is **honestly absent** for a `file` source: there is nothing public to link to, and the
 * share sheet then carries the text alone rather than a broken link. Only the server knows which
 * source is playing (`parseSourceUri`) and which is best (`getBestSource`), so only the server
 * can build this.
 */
export const ShareTargetSchema = z.object({
  title: z.string(),
  text: z.string(),
  url: z.url().optional(),
  mimeType: z.string().default('text/plain'),
});
export type ShareTarget = z.infer<typeof ShareTargetSchema>;

/**
 * Actions resolved on the device, with no round trip. They carry everything they need.
 */
const ClientActionSchemas = [
  z.object({ kind: z.literal('copy') }),
  z.object({ kind: z.literal('share'), target: ShareTargetSchema }),
  z.object({ kind: z.literal('open_url'), url: z.url(), label: z.string() }),
] as const;

/**
 * Actions that round-trip through `chat:action`. Their parameters are bound by the server when the
 * action is declared, so the frame the client sends back is echoed rather than composed.
 */
const ServerActionSchemas = [
  z.object({ kind: z.literal('retry') }),
  z.object({ kind: z.literal('song_info'), songId: z.string() }),
  z.object({ kind: z.literal('play_now'), songId: z.string(), source: SourceNameSchema }),
  z.object({ kind: z.literal('queue_next'), songId: z.string() }),
  z.object({ kind: z.literal('remove_from_playlist'), songId: z.string() }),
] as const;

/**
 * The transport bar's buttons.
 *
 * Which of these is declared is a function of the player's current state — `mpc_pause` while
 * playing and `mpc_play` otherwise, no `mpc_previous` at the head of the queue — so the bar is
 * drawn from what arrives rather than from the client's own idea of what should be enabled.
 *
 * `mpc_seek` is the one action whose value comes from the client rather than the server: the
 * declaration carries the range (`durationMs`), the frame carries `params.positionMs`, and the
 * gateway validates the value against the declared range. A future `mpc_volume` takes the same
 * shape.
 */
const TransportActionSchemas = [
  z.object({ kind: z.literal('mpc_play') }),
  z.object({ kind: z.literal('mpc_pause') }),
  z.object({ kind: z.literal('mpc_stop') }),
  z.object({ kind: z.literal('mpc_next') }),
  z.object({ kind: z.literal('mpc_previous') }),
  z.object({ kind: z.literal('mpc_seek'), durationMs: z.number().int().nonnegative() }),
] as const;

export const ChatActionSchema = z.discriminatedUnion('kind', [...ClientActionSchemas, ...ServerActionSchemas, ...TransportActionSchemas]);
export type ChatAction = z.infer<typeof ChatActionSchema>;
export type ChatActionKind = ChatAction['kind'];

/** Parameters a client supplies for the few actions that take a value. See `mpc_seek`. */
export const ActionParamsSchema = z.object({
  positionMs: z.number().int().nonnegative().optional(),
});
export type ActionParams = z.infer<typeof ActionParamsSchema>;

/**
 * One row of a `playlist` payload.
 *
 * `elementId` is what makes a long press on a single row addressable: `chat:action` names the
 * message and then the element inside it, and the row carries its own `actions` rather than
 * inheriting the message's.
 *
 * `state` is what turns the message from a printed receipt into a view of the MPD queue — it is
 * recomputed by the queue watcher and republished on the same envelope id at a higher `rev`.
 */
export const PlaylistItemSchema = z.object({
  elementId: z.string(),
  position: z.number().int().nonnegative(),
  /** Absent for a catalog-only stream — a Qobuz track played without ever being imported. */
  songId: z.string().optional(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  source: SourceNameSchema,
  artworkUrl: z.url().optional(),
  state: z.enum(['queued', 'playing', 'played', 'removed']).default('queued'),
  actions: z.array(ChatActionSchema).default([]),
});
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;
