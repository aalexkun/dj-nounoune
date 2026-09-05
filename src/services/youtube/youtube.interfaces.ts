import { z } from 'zod';

/**
 * Zod contracts for the YouTube Data API v3, plus the domain shapes the service hands back.
 *
 * Everything crossing the wire starts as `unknown` and is parsed here. The API is far more
 * regular than Qobuz about absence — a field it has no value for is simply missing rather than
 * `null` — so a plain `.optional()` is enough almost everywhere. The exception is `thumbnails`,
 * where individual sizes come and go per video, and `snippet.tags`, absent on most uploads.
 */

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The Google API error envelope. It replaces the whole body on failure, so it is checked before
 * the success schema rather than alongside it.
 *
 * `reason` is the field worth surfacing: `quotaExceeded` and `dailyLimitExceeded` are the two
 * that mean "come back tomorrow" rather than "the request was wrong", and they are otherwise
 * indistinguishable from any other 403.
 */
export const YoutubeErrorResponseSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    status: z.string().optional(),
    errors: z
      .array(
        z.object({
          domain: z.string().optional(),
          reason: z.string().optional(),
          message: z.string().optional(),
        }),
      )
      .optional(),
  }),
});
export type YoutubeErrorResponse = z.infer<typeof YoutubeErrorResponseSchema>;

/** Error reasons that mean the daily quota is spent, not that the request was malformed. */
export const QUOTA_ERROR_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded']);

/** How `YoutubeService` words a quota failure, so a caller can tell it from a real error. */
export const YOUTUBE_QUOTA_ERROR_PREFIX = 'YouTube API quota exhausted';

/**
 * Whether a failure is YouTube refusing on quota rather than on the request. Callers that would
 * otherwise record the failure as permanent — the negentropy ledger — use this to defer instead.
 */
export function isYoutubeQuotaError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(YOUTUBE_QUOTA_ERROR_PREFIX);
}

/* -------------------------------------------------------------------------- */
/* Shared snippet pieces                                                      */
/* -------------------------------------------------------------------------- */

export const YoutubeThumbnailSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type YoutubeThumbnail = z.infer<typeof YoutubeThumbnailSchema>;

/**
 * Which sizes are present varies by video, so every one is optional. `maxres` only exists for
 * uploads sourced at 1280x720 or better, which most auto-generated music videos are not.
 */
export const YoutubeThumbnailsSchema = z.object({
  default: YoutubeThumbnailSchema.optional(),
  medium: YoutubeThumbnailSchema.optional(),
  high: YoutubeThumbnailSchema.optional(),
  standard: YoutubeThumbnailSchema.optional(),
  maxres: YoutubeThumbnailSchema.optional(),
});
export type YoutubeThumbnails = z.infer<typeof YoutubeThumbnailsSchema>;

/* -------------------------------------------------------------------------- */
/* search.list                                                                */
/* -------------------------------------------------------------------------- */

export const YoutubeSearchItemSchema = z.object({
  id: z.object({
    kind: z.string(),
    videoId: z.string().optional(),
    playlistId: z.string().optional(),
    channelId: z.string().optional(),
  }),
  snippet: z
    .object({
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      thumbnails: YoutubeThumbnailsSchema.optional(),
      liveBroadcastContent: z.string().optional(),
    })
    .optional(),
});
export type YoutubeSearchItem = z.infer<typeof YoutubeSearchItemSchema>;

/**
 * Every list response shares this envelope. `items` stays `unknown` because the service re-parses
 * each entry on its own: one drifted hit must cost that hit, not the whole page.
 */
export const YoutubeListEnvelopeSchema = z.object({
  nextPageToken: z.string().optional(),
  pageInfo: z
    .object({
      totalResults: z.number().optional(),
      resultsPerPage: z.number().optional(),
    })
    .optional(),
  items: z.array(z.unknown()),
});
export type YoutubeListEnvelope = z.infer<typeof YoutubeListEnvelopeSchema>;

/* -------------------------------------------------------------------------- */
/* videos.list                                                                */
/* -------------------------------------------------------------------------- */

export const YoutubeVideoSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      thumbnails: YoutubeThumbnailsSchema.optional(),
      tags: z.array(z.string()).optional(),
      /** `10` is the Music category — the only one this platform is interested in. */
      categoryId: z.string().optional(),
      liveBroadcastContent: z.string().optional(),
      defaultAudioLanguage: z.string().optional(),
    })
    .optional(),
  contentDetails: z
    .object({
      /** ISO 8601, e.g. `PT4M13S`. Parsed by `parseIsoDuration`. */
      duration: z.string().optional(),
      definition: z.string().optional(),
      licensedContent: z.boolean().optional(),
    })
    .optional(),
  status: z
    .object({
      privacyStatus: z.string().optional(),
      embeddable: z.boolean().optional(),
    })
    .optional(),
});
export type YoutubeVideo = z.infer<typeof YoutubeVideoSchema>;

/* -------------------------------------------------------------------------- */
/* playlists.list                                                             */
/* -------------------------------------------------------------------------- */

export const YoutubePlaylistSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      thumbnails: YoutubeThumbnailsSchema.optional(),
    })
    .optional(),
  contentDetails: z
    .object({
      itemCount: z.number().optional(),
    })
    .optional(),
});
export type YoutubePlaylist = z.infer<typeof YoutubePlaylistSchema>;

/* -------------------------------------------------------------------------- */
/* playlistItems.list                                                         */
/* -------------------------------------------------------------------------- */

export const YoutubePlaylistItemSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      playlistId: z.string().optional(),
      /** Zero-based. The track number is this plus one. */
      position: z.number().optional(),
      title: z.string(),
      description: z.string().optional(),
      thumbnails: YoutubeThumbnailsSchema.optional(),
      /**
       * The channel that uploaded the video, as opposed to `channelTitle`, which is the channel
       * that owns the playlist. On an auto-generated release playlist those differ, and it is
       * this one that names the artist.
       */
      videoOwnerChannelTitle: z.string().optional(),
      videoOwnerChannelId: z.string().optional(),
      resourceId: z
        .object({
          kind: z.string().optional(),
          videoId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  contentDetails: z
    .object({
      videoId: z.string().optional(),
      videoPublishedAt: z.string().optional(),
    })
    .optional(),
});
export type YoutubePlaylistItem = z.infer<typeof YoutubePlaylistItemSchema>;

/* -------------------------------------------------------------------------- */
/* channels.list                                                              */
/* -------------------------------------------------------------------------- */

export const YoutubeChannelSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      customUrl: z.string().optional(),
      country: z.string().optional(),
      thumbnails: YoutubeThumbnailsSchema.optional(),
    })
    .optional(),
});
export type YoutubeChannel = z.infer<typeof YoutubeChannelSchema>;

/* -------------------------------------------------------------------------- */
/* OAuth                                                                      */
/* -------------------------------------------------------------------------- */

/** What Google's token endpoint answers on both the code exchange and a refresh. */
export const GoogleTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  /** Only on the code exchange, and only when `access_type=offline` was asked for. */
  refresh_token: z.string().optional(),
});
export type GoogleTokenResponse = z.infer<typeof GoogleTokenResponseSchema>;

/** Shape of `.youtube-session.json`, written by the auth flow and read back on boot. */
export const YoutubeSessionSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  /** Epoch milliseconds. */
  expirationTime: z.number().optional(),
  scope: z.string().optional(),
});
export type YoutubeSession = z.infer<typeof YoutubeSessionSchema>;

/* -------------------------------------------------------------------------- */
/* Domain shapes                                                              */
/* -------------------------------------------------------------------------- */

/** How well a candidate video answered the search criteria. Mirrors `QobuzTrackMatchScore`. */
export interface YoutubeTrackMatchScore {
  total: number;
  title: number;
  artist: number;
  album: number;
}

/** What the caller asked for. `title` is mandatory; the rest narrow and rank. */
export interface YoutubeTrackSearchCriteria {
  title: string;
  artist?: string;
  album?: string;
  limit?: number;
}

/**
 * One ranked hit, with the `Artist - Title` split already applied.
 *
 * `title` and `artist` are the *interpreted* values (see `parseVideoTitle`), while `videoTitle`
 * keeps the raw upload title. Both matter: the interpreted pair is what gets written to Mongo and
 * scored against, the raw one is what a human recognises in a CLI listing.
 */
export interface YoutubeTrackMatch {
  /** The 11-character video id. This is what `SongSource.sourceId` stores. */
  id: string;
  title: string;
  artist: string;
  /** Raw upload title, before the `Artist - Title` split and suffix stripping. */
  videoTitle: string;
  channelId?: string;
  channelTitle?: string;
  /** Seconds, from the ISO 8601 `contentDetails.duration`. Zero when details were not fetched. */
  duration: number;
  /** True for `categoryId === '10'`, i.e. what YouTube itself files under Music. */
  isMusicCategory: boolean;
  /** True when the uploading channel is a YouTube Music `… - Topic` auto-channel. */
  isTopicChannel: boolean;
  thumbnails?: YoutubeThumbnails;
  score: YoutubeTrackMatchScore;
  matchedQuery: string;
}

/** A playlist reduced to what the album mapping needs. */
export interface YoutubePlaylistMatch {
  id: string;
  title: string;
  channelId?: string;
  channelTitle?: string;
  description?: string;
  itemCount?: number;
  thumbnails?: YoutubeThumbnails;
}

/** One entry of a playlist, in playlist order, interpreted the same way a search hit is. */
export interface YoutubePlaylistTrack {
  videoId: string;
  title: string;
  artist: string;
  videoTitle: string;
  /** One-based, from `snippet.position`. */
  trackNumber: number;
  channelId?: string;
  channelTitle?: string;
  duration: number;
  thumbnails?: YoutubeThumbnails;
}

/** What one playlist import did, for the CLI to print. */
export interface YoutubeImportResult {
  playlistId: string;
  playlistTitle: string;
  artistName: string;
  tracksSeen: number;
  songsCreated: number;
  sourcesAttached: number;
  alreadyPresent: number;
  skipped: string[];
}
