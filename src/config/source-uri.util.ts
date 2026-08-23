import { ConfigService } from '@nestjs/config';
import { SourceType } from '../schemas/source.schema';

/**
 * The two directions of one mapping: the uri a source is queued in MPD under, and the source an
 * entry already in the queue came from.
 *
 * They live together because they have to agree. The MPD queue is mixed — a single playlist can
 * hold a local file, a Qobuz stream and a Spotify stream side by side, queued by this app or by any
 * other client pointed at the same daemon — and the only thing tying a queue entry back to a song
 * document is the shape of its uri. Build it in one file and parse it in another and the playlog
 * silently stops recognising half of what plays.
 */

/** Path the Qobuz proxy exposes a track under. Mirrored on a qobuz `SongSource.path`. */
export const QOBUZ_TRACK_PATH = '/qobuz/track/version/1/trackId/';

/** Path the Spotify audio proxy exposes a track under. The uri after `?uri=` is the `SongSource.path`. */
export const SPOTIFY_TRACK_PATH = '/spotify?uri=spotify:track:';

/** What an entry of the MPD queue turned out to be. */
export type ResolvedSourceUri = {
  name: SourceType;
  /** Provider-specific id, in the form `SongSource.sourceId` stores it for that source. */
  sourceId: string;
};

/**
 * Recognised uri shapes, most specific first.
 *
 * The spotify entry matches both what `PlayMusicHandler` queues through the proxy
 * (`…/spotify?uri=spotify:track:ID`) and a bare `spotify:track:ID`, because the same id appears in
 * both and another client may well have queued the bare form.
 *
 * `youtube` is listed even though no importer writes a youtube source yet: a YouTube url in the
 * queue is unmistakably YouTube, and naming it means the lookup misses honestly and the caller
 * falls back to the MPD tags — where treating it as a local path would claim a file that does not
 * exist. `applemusic` is deliberately absent: nothing queues it and its uri shape is unknown, so
 * there is nothing to match that would not be a guess.
 */
const URI_PATTERNS: ReadonlyArray<{ name: SourceType; pattern: RegExp }> = [
  { name: 'qobuz', pattern: /\/qobuz\/track\/version\/\d+\/trackId\/(\d+)/i },
  { name: 'spotify', pattern: /spotify:track:([A-Za-z0-9]+)/i },
  { name: 'spotify', pattern: /open\.spotify\.com\/track\/([A-Za-z0-9]+)/i },
  { name: 'youtube', pattern: /(?:youtube\.com\/watch\?(?:[^\s]*&)?v=|youtu\.be\/|\/youtube\/(?:watch\/)?)([A-Za-z0-9_-]{11})/i },
];

/**
 * Which source an MPD queue entry is playing from.
 *
 * Anything unrecognised is a local file, which is the right default: MPD's own music directory is
 * addressed by plain relative paths, and that is what every entry not put there by a proxy is.
 */
export function parseSourceUri(uri: string): ResolvedSourceUri {
  for (const { name, pattern } of URI_PATTERNS) {
    const match = uri.match(pattern);

    if (match?.[1]) {
      return { name, sourceId: match[1] };
    }
  }

  return { name: 'file', sourceId: uri };
}

/**
 * The MPD uri for a Qobuz track id. MPD cannot talk to Qobuz itself, so everything goes through
 * the proxy named by `QOBUZ_STREAM_PROXY_SERVER`; without it there is nothing to queue.
 */
export function qobuzStreamUri(configService: ConfigService, trackId: string | number): string {
  const proxy = configService.get<string>('QOBUZ_STREAM_PROXY_SERVER');

  if (!proxy) {
    throw new Error('QOBUZ_STREAM_PROXY_SERVER is not defined, cannot queue a Qobuz stream');
  }

  return `${proxy}${QOBUZ_TRACK_PATH}${trackId}`;
}

/** The MPD uri for a Spotify track id, through the proxy named by `SPOTIFY_PROXY_AUDIO`. */
export function spotifyStreamUri(configService: ConfigService, trackId: string): string {
  const proxy = configService.get<string>('SPOTIFY_PROXY_AUDIO');

  if (!proxy) {
    throw new Error('SPOTIFY_PROXY_AUDIO is not defined, cannot queue a Spotify stream');
  }

  return `${proxy}${SPOTIFY_TRACK_PATH}${trackId}`;
}
