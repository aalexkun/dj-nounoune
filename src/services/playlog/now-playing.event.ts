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
  isCdQuality?: boolean;
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

/**
 * All the tool layer needs of `PlaylogService`, declared here rather than imported from it.
 *
 * `PlaylogService` already injects `ToolsService` to reach the disc jockey, so a direct dependency
 * the other way round would close a cycle. The service registers itself through
 * `ToolsService.setNowPlayingSource` instead — the same break used for the disc jockey agent.
 */
export interface NowPlayingSource {
  getNowPlayingSnapshot(): Promise<NowPlaying | null>;
}

/**
 * Where a cover taken out of MPD is served from — the bytes never leave the backend, the page just
 * gets an address for them. Matched by the `artwork/:songId` route on `VibingController`.
 */
export function mpdArtworkUrl(songId: string): string {
  return `/vibing-on/artwork/${songId}`;
}

/**
 * The two enrichments are resolved independently and announced on their own events, so a slow
 * artwork search never holds back the commentary and neither delays the base snapshot. Each carries
 * the songId it belongs to: a viewer that has already moved on to the next track ignores it.
 */
export const NowPlayingCommentaryEventName = 'playlog.now-playing.commentary';
export const NowPlayingCoverEventName = 'playlog.now-playing.cover';

export interface NowPlayingCommentary {
  songId: string;
  /** The disc jockey's markdown narration of the track. */
  description: string;
}

export interface NowPlayingCover {
  songId: string;
  coverUrl: string;
}

export class NowPlayingCommentaryEvent {
  constructor(public readonly commentary: NowPlayingCommentary) {}
}

export class NowPlayingCoverEvent {
  constructor(public readonly cover: NowPlayingCover) {}
}
