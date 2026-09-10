import { SourceType } from '../../schemas/source.schema';
import { ShareTarget } from './protocol';

/**
 * Where a recording can be pointed at on the public web, by the source it is playing from.
 *
 * Only the server can build these: it is the side that knows which `SongSource` MPD actually
 * resolved to. The phone sees a title and an artist.
 */
const PUBLIC_URL: Partial<Record<SourceType, (sourceId: string) => string>> = {
  qobuz: (id) => `https://open.qobuz.com/track/${id}`,
  spotify: (id) => `https://open.spotify.com/track/${id}`,
  youtube: (id) => `https://www.youtube.com/watch?v=${id}`,
};

export type ShareableTrack = {
  title: string;
  artist: string;
  album?: string;
  source?: SourceType;
  sourceId?: string;
};

/**
 * The share payload for one track.
 *
 * `url` is **honestly absent** for a local file, and for any source with no public page. The share
 * sheet then carries the text alone rather than a link that goes nowhere — which is why the action
 * is still offered rather than hidden: sharing "Portishead — Roads" with a friend is useful even
 * when the copy you are playing lives on a disk in your hallway.
 */
export function shareTargetFor(track: ShareableTrack): ShareTarget {
  const album = track.album ? ` (${track.album})` : '';
  const build = track.source ? PUBLIC_URL[track.source] : undefined;
  const url = build && track.sourceId ? build(track.sourceId) : undefined;

  return {
    title: track.title,
    text: `${track.artist} — ${track.title}${album}`,
    url,
    mimeType: 'text/plain',
  };
}
