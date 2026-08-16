import { SourceType } from '../../schemas/source.schema';

export const NowPlayingEventName = 'playlog.now-playing';

/** One entry of the "just played" strip. */
export interface RecentlyPlayed {
  title: string;
  artist: string;
  coverUrl?: string;
}

/**
 * Everything the public /vibing-on page renders. Built from Mongo on a song change and pushed
 * straight away; `coverUrl` and `description` may be filled in by a second push once the LLM
 * enrichment resolves.
 */
export interface NowPlaying {
  songId: string;
  title: string;
  artist: string;
  album: string;
  year?: string;
  genre?: string;
  category?: string;
  emotion?: string;
  pace?: string;
  trackNumber?: number;
  discNumber?: number;
  label?: string;
  country?: string;
  language?: string;
  /** The source MPD is actually playing from, not the best available one. */
  sourceName?: SourceType;
  encoding?: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  isHighRes?: boolean;
  duration?: number;
  bpm?: number;
  coverUrl?: string;
  artistIntro?: string;
  /** The disc jockey's markdown narration of the track. */
  description?: string;
  playedAt: string;
  recent: RecentlyPlayed[];
}

export class NowPlayingEvent {
  constructor(public readonly nowPlaying: NowPlaying) {}
}
