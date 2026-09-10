import { z } from 'zod';
import { SOURCE_TYPES } from '../../schemas/source.schema';

/** Redis key holding the reconciled queue projection. No expiry: it mirrors a live daemon. */
export const QUEUE_STATE_KEY = 'mpd:queue';

/** Redis key prefix binding a chat to the `playlist` envelope the queue watcher keeps in step. */
export const PLAYLIST_BINDING_PREFIX = 'chat:playlist:';

/** A binding is worth keeping for about a listening session, not forever. */
export const PLAYLIST_BINDING_TTL_SECONDS = 24 * 60 * 60;

export const QueueEntrySchema = z.object({
  /** MPD's queue id. Survives a reorder; does **not** survive a negentropy swap. */
  mpdSongId: z.string(),
  position: z.number().int().nonnegative(),
  uri: z.string(),
  source: z.enum(SOURCE_TYPES),
  sourceId: z.string(),
  /** The library document behind this entry, when the uri resolved to one. */
  songId: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;

/**
 * What MPD's queue looked like at one moment.
 *
 * `bootEpoch` and `dbUpdate` come from `stats` and are what make the cheap path safe: a boot epoch
 * that moved means the daemon restarted and the version counter is meaningless, and a changed
 * `dbUpdate` means the library was rescanned and any resolved `songId` may be stale.
 */
export const QueueSnapshotSchema = z.object({
  version: z.number().int().nonnegative(),
  bootEpoch: z.number().int(),
  dbUpdate: z.number().int().nullable(),
  state: z.enum(['play', 'pause', 'stop', 'unknown']),
  currentMpdSongId: z.string().nullable(),
  currentPosition: z.number().int().nonnegative().nullable(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  volume: z.number().int().min(0).max(100).nullable(),
  modes: z.object({ repeat: z.boolean(), random: z.boolean(), single: z.boolean(), consume: z.boolean() }),
  entries: z.array(QueueEntrySchema),
  at: z.number().int(),
});
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;

/**
 * Which `playlist` envelope a chat's queue belongs to.
 *
 * Only the newest playlist per chat is bound, and therefore only the newest one is kept live —
 * otherwise every playlist ever sent would re-broadcast on every queue change.
 *
 * `songIds` is the primary key for reconciliation rather than the MPD ids: a negentropy swap
 * deletes and re-adds an entry, so the MPD id changes while the recording does not.
 */
export const PlaylistBindingSchema = z.object({
  messageId: z.string(),
  chatId: z.string(),
  sessionId: z.string(),
  songIds: z.array(z.string()),
  uris: z.array(z.string()),
  createdAt: z.number().int(),
});
export type PlaylistBinding = z.infer<typeof PlaylistBindingSchema>;

export function playlistBindingKey(chatId: string): string {
  return `${PLAYLIST_BINDING_PREFIX}${chatId}`;
}

/**
 * Carries the published `playlist` envelope id from the disc jockey to `play_music`.
 *
 * The model is what connects those two calls, and it only passes the cache key — the message id is
 * ours and has no business in a function declaration. So it travels beside the cached playlist,
 * under a key derived from the same cache key.
 */
export const PlaylistMessageRefSchema = z.object({
  messageId: z.string(),
  chatId: z.string(),
  sessionId: z.string(),
});
export type PlaylistMessageRef = z.infer<typeof PlaylistMessageRefSchema>;

export function playlistMessageKey(cacheKey: string): string {
  return `${cacheKey}:message`;
}
