import { getBestSource, ScorableSource } from '../../config/best-source.util';
import { SourceType } from '../../schemas/source.schema';
import { PlaylistItem } from './protocol';
import { shareTargetFor } from './share-target.util';

/** The minimum a caller has to know about a track to put it in a playlist message. */
export type PlaylistTrack = {
  songId?: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  artworkUrl?: string;
  sources?: readonly ScorableSource[];
  /** Overrides the source derived from `sources`; the queue watcher passes what MPD is really on. */
  source?: SourceType;
  sourceId?: string;
  state?: PlaylistItem['state'];
};

/**
 * One playlist row, with the actions the client hangs off a long press.
 *
 * The action set is derived here rather than on the device because it depends on facts the device
 * does not have: whether the recording exists as a `Song` document at all (a Qobuz stream played
 * straight from the catalog does not), and which source it is playing from, which is what decides
 * whether there is a url to share.
 */
export function playlistItem(track: PlaylistTrack, position: number): PlaylistItem {
  const best = getBestSource(track.sources);
  const source = track.source ?? best?.name ?? 'file';
  const sourceId = track.sourceId ?? best?.sourceId ?? undefined;

  // A song has no duration of its own — it is a fact about the encoding, so it lives on the
  // source, in seconds. Read it off whichever source playback would actually pick.
  const seconds = best?.technical_info?.duration;
  const durationMs = track.durationMs ?? (seconds ? Math.round(seconds * 1000) : undefined);

  const actions: PlaylistItem['actions'] = [
    // A row's copy is that song, not the numbered list the envelope's own menu copies.
    { kind: 'copy' },
    { kind: 'share', target: shareTargetFor({ title: track.title, artist: track.artist, album: track.album, source, sourceId }) },
  ];

  // Everything below addresses a library document. A catalog-only stream has none, and offering
  // "get info" on a song that was never imported would just produce a dead end.
  if (track.songId) {
    actions.push({ kind: 'song_info', songId: track.songId });
    actions.push({ kind: 'play_now', songId: track.songId, source });
    actions.push({ kind: 'queue_next', songId: track.songId });
    actions.push({ kind: 'remove_from_playlist', songId: track.songId });
  }

  return {
    elementId: `row-${position}`,
    position,
    songId: track.songId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs,
    source,
    artworkUrl: track.artworkUrl,
    state: track.state ?? 'queued',
    actions,
  };
}

export function playlistItems(tracks: readonly PlaylistTrack[]): PlaylistItem[] {
  return tracks.map((track, index) => playlistItem(track, index));
}
