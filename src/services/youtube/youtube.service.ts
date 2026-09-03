import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { SongSource } from '../../schemas/source.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';
import { DuplicateSongCheck, OpensearchService } from '../opensearch/opensearch.service';
import { PopulatedSong } from '../music-db/music-db.service';
import { YoutubeAuthUtil } from './youtube-auth.util';
import {
  QUOTA_ERROR_REASONS,
  YoutubeChannel,
  YoutubeChannelSchema,
  YoutubeErrorResponseSchema,
  YoutubeImportResult,
  YoutubeListEnvelopeSchema,
  YoutubePlaylistItemSchema,
  YoutubePlaylistMatch,
  YoutubePlaylistSchema,
  YoutubePlaylistTrack,
  YoutubeSearchItemSchema,
  YoutubeSession,
  YoutubeTrackMatch,
  YoutubeTrackSearchCriteria,
  YoutubeVideo,
  YoutubeVideoSchema,
} from './youtube.interfaces';
import {
  bestThumbnailUrl,
  buildSearchQueries,
  describeParseFailure,
  isTopicChannel,
  normalizeChannelTitle,
  parseIsoDuration,
  parseVideoTitle,
  scoreVideo,
  stripReleasePrefix,
} from './youtube-track-match.util';
import { getErrorMessage } from '../../utils/error.utils';

/** Hits scoring below this are not returned by {@link YoutubeService.findTrack}. */
const MINIMUM_MATCH_SCORE = 0.6;

/** Once a hit reaches this score, trying the broader fallback queries is pointless. */
const CONFIDENT_MATCH_SCORE = 0.9;

/** Search hits requested per query when the caller does not say. */
const DEFAULT_SEARCH_LIMIT = 25;

/** `videos.list` accepts at most 50 ids per call, and charges one unit however many are asked for. */
const VIDEO_DETAIL_BATCH = 50;

/** `playlistItems.list` page size ceiling. */
const PLAYLIST_PAGE_SIZE = 50;

/** YouTube's own category id for Music. */
const MUSIC_CATEGORY_ID = '10';

/**
 * What a YouTube stream is, technically.
 *
 * Nothing in the Data API reports the audio format — it describes videos, not renditions — so this
 * is what the playback backend actually delivers rather than anything the API said. On a Premium
 * account that is the 256 kbps AAC rendition at 44.1 kHz, which is what these numbers assume.
 *
 * The values matter beyond bookkeeping: `PlayMusicHandler.getBestSource` scores sources by exactly
 * these fields on one additive scale, so they place YouTube in the library's quality order rather
 * than merely describing it:
 *
 *  - `is_cd_quality: false` keeps it below every lossless source, which take a 500,000 bonus.
 *  - 256 kbps puts it just under Spotify's 320 kbps Ogg — the bitrate term is what separates the
 *    two lossy streams, not the per-source name bonus.
 *  - and above the library's 128/192 kbps mp3s, which is the point: for those songs the stream is
 *    genuinely the better rendition.
 *
 * Overstating any of this would let a YouTube re-encode outrank a local FLAC, so the honest values
 * are load-bearing.
 */
const YOUTUBE_TECHNICAL_DEFAULTS = {
  bitrate: 256000,
  sample_rate: 44100,
  bit_depth: 16,
  is_high_res: false,
  is_cd_quality: false,
  extension: 'm4a',
  encoding: 'aac',
} as const;

/** How close to expiry the access token is refreshed. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Calls that need the user's own account rather than just an API key. */
type AuthMode = 'key' | 'oauth';

/**
 * The YouTube Data API v3, hand-rolled on `fetch`.
 *
 * Mirrors `QobuzService` in shape — search, lookup, import, and a `SongSource` builder — with two
 * differences the rest of the platform has to know about.
 *
 * **Auth is split.** Search and public lookups need only `YOUTUBE_API_KEY`; OAuth is required
 * solely for the signed-in account's liked videos and private playlists. The service is fully
 * usable with a key alone, and says so rather than throwing, because that is the common case.
 *
 * **There is no album.** A video carries a title, a channel and a duration, and nothing else that
 * maps onto the `Artist -> Album -> Song` triangle. A *playlist* is the only YouTube object with
 * album-like structure — an ordered, titled, artwork-bearing set of tracks — so playlists are what
 * become albums, and {@link importPlaylist} is the only path that writes songs. Loose videos found
 * by {@link searchTracks} are playable but are never imported: inventing an album for a video
 * somebody asked to hear once would seed the library with rows no importer ever saw, the same
 * stance `PlayQobuzHandler` takes for catalog-only Qobuz tracks.
 */
@Injectable()
export class YoutubeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(YoutubeService.name);

  private readonly API_BASE_URL = 'https://www.googleapis.com/youtube/v3';

  private apiKey = '';
  private session: YoutubeSession = {};
  private refreshInterval: NodeJS.Timeout | null = null;

  public auth!: YoutubeAuthUtil;

  constructor(
    private readonly configService: ConfigService,
    private readonly opensearchService: OpensearchService,
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {}

  public onModuleInit(): void {
    this.auth = new YoutubeAuthUtil(this.configService);
    this.apiKey = this.configService.get<string>('YOUTUBE_API_KEY') ?? '';

    if (!this.apiKey) {
      this.logger.warn(
        'YOUTUBE_API_KEY is missing. Searching and public lookups will fail until it is set; ' +
          'an OAuth session alone can still answer the account-scoped calls.',
      );
    }

    this.session = this.auth.loadSession();

    if (this.session.refreshToken || this.session.accessToken) {
      this.startTokenRefreshInterval();
    } else {
      this.logger.debug(
        'No .youtube-session.json found. Only public YouTube data is reachable; run "cli youtube auth" for the rest.',
      );
    }
  }

  public onModuleDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Auth                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Keeps the access token alive in the background, the same way `SpotifyService` does.
   *
   * The token lives an hour; the interval checks once a minute and renews inside a five minute
   * margin, so a long-running import never trips over an expiry mid-page.
   */
  private startTokenRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    const checkRefresh = () => {
      if (!this.session.refreshToken) {
        return;
      }

      const expiresAt = this.session.expirationTime;

      if (!expiresAt || expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS) {
        void this.refreshToken();
      }
    };

    checkRefresh();
    this.refreshInterval = setInterval(checkRefresh, 60 * 1000);
  }

  private async refreshToken(): Promise<void> {
    try {
      const refreshed = await this.auth.refreshAccessToken(this.session.refreshToken ?? '');

      if (refreshed) {
        this.session = refreshed;
        this.logger.log('YouTube access token refreshed successfully.');
      }
    } catch (error) {
      this.logger.error(`Failed to refresh the YouTube access token: ${getErrorMessage(error)}`);
    }
  }

  /**
   * The access token for an account-scoped call, refreshing it first when it is about to expire.
   *
   * @throws When there is no session at all — the caller asked for the user's own data and there
   *   is no user, which no amount of retrying fixes.
   */
  private async getAccessToken(): Promise<string> {
    if (!this.session.accessToken && !this.session.refreshToken) {
      throw new Error(
        'YouTube session data (.youtube-session.json) is missing. Please authenticate first by running "npm run cli -- youtube auth".',
      );
    }

    const expiresAt = this.session.expirationTime;

    if (this.session.refreshToken && (!expiresAt || expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS)) {
      await this.refreshToken();
    }

    if (!this.session.accessToken) {
      throw new Error('The YouTube session holds no usable access token. Re-run "npm run cli -- youtube auth".');
    }

    return this.session.accessToken;
  }

  /** Whether an OAuth session is present. Callers use it to skip account-scoped work entirely. */
  public isAuthenticated(): boolean {
    return !!(this.session.accessToken || this.session.refreshToken);
  }

  /* ------------------------------------------------------------------ */
  /* Transport                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * One GET against the Data API, validated on the way out.
   *
   * The response body is `unknown` until it has been through `schema`. The error envelope is
   * checked first because Google replaces the entire body with it on failure, so the success
   * schema would report a confusing "items is required" for what is really a 403.
   *
   * @param authMode - `key` uses `YOUTUBE_API_KEY`; `oauth` sends the user's bearer token. The two
   *   are mutually exclusive by design — sending a key alongside a bearer token makes Google
   *   attribute quota to the key's project but resolve `mine=true` against nobody.
   */
  private async youtubeGet<T>(
    endpoint: string,
    params: Record<string, string>,
    schema: z.ZodSchema<T>,
    authMode: AuthMode = 'key',
  ): Promise<T> {
    const query = new URLSearchParams(params);
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (authMode === 'oauth') {
      headers['Authorization'] = `Bearer ${await this.getAccessToken()}`;
    } else {
      if (!this.apiKey) {
        throw new Error('YOUTUBE_API_KEY is not defined, cannot call the YouTube Data API.');
      }
      query.append('key', this.apiKey);
    }

    const url = `${this.API_BASE_URL}${endpoint}?${query.toString()}`;
    const response = await fetch(url, { headers });
    const json = (await response.json()) as unknown;

    const errorResult = YoutubeErrorResponseSchema.safeParse(json);

    if (errorResult.success) {
      const { code, message, errors } = errorResult.data.error;
      const reason = errors?.find((entry) => entry.reason)?.reason;

      // Quota is called out by name because the fix is entirely different: nothing about the
      // request was wrong and retrying it today will not help.
      if (reason && QUOTA_ERROR_REASONS.has(reason)) {
        throw new Error(
          `YouTube API quota exhausted (${reason}): ${message}. ` +
            'The default allowance is 10,000 units per day and a single search costs 100.',
        );
      }

      throw new Error(`YouTube API Error ${code}${reason ? ` (${reason})` : ''}: ${message}`);
    }

    return schema.parse(json);
  }

  /**
   * Parses a list payload item by item, dropping the ones the schema no longer accepts.
   *
   * A drifted field must cost that one entry, not the whole page — the same reason
   * `QobuzService.searchTracks` re-parses each hit rather than typing the array.
   */
  private parseItems<T>(items: unknown[], schema: z.ZodSchema<T>, context: string): T[] {
    const parsed: T[] = [];

    for (const item of items) {
      const result = schema.safeParse(item);

      if (result.success) {
        parsed.push(result.data);
      } else {
        this.logger.warn(`Discarding a YouTube ${context} the schema no longer accepts: ${describeParseFailure(item, result.error)}`);
      }
    }

    return parsed;
  }

  /* ------------------------------------------------------------------ */
  /* Public lookups                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Full details for a batch of video ids.
   *
   * Batched deliberately: `videos.list` costs one quota unit per call regardless of how many ids
   * it is given, up to 50, while `search.list` costs 100. Every id known up front should come
   * through here rather than through a search.
   */
  public async getVideos(videoIds: string[]): Promise<YoutubeVideo[]> {
    const unique = [...new Set(videoIds.filter((id) => !!id))];

    if (unique.length === 0) {
      return [];
    }

    const videos: YoutubeVideo[] = [];

    for (let offset = 0; offset < unique.length; offset += VIDEO_DETAIL_BATCH) {
      const batch = unique.slice(offset, offset + VIDEO_DETAIL_BATCH);

      const response = await this.youtubeGet(
        '/videos',
        {
          part: 'snippet,contentDetails,status',
          id: batch.join(','),
          maxResults: String(VIDEO_DETAIL_BATCH),
        },
        YoutubeListEnvelopeSchema,
      );

      videos.push(...this.parseItems(response.items, YoutubeVideoSchema, 'video'));
    }

    return videos;
  }

  /** One video by id, or `null` when YouTube has no such video (or it is private). */
  public async getVideo(videoId: string): Promise<YoutubeVideo | null> {
    const [video] = await this.getVideos([videoId]);
    return video ?? null;
  }

  /** One channel by id, used to name the artist behind a playlist. */
  public async getChannel(channelId: string): Promise<YoutubeChannel | null> {
    if (!channelId) {
      return null;
    }

    const response = await this.youtubeGet(
      '/channels',
      { part: 'snippet', id: channelId },
      YoutubeListEnvelopeSchema,
    );

    const [channel] = this.parseItems(response.items, YoutubeChannelSchema, 'channel');

    return channel ?? null;
  }

  /**
   * Searches YouTube for music videos, ranked best match first.
   *
   * Two calls per query: `search.list` for the ids, then one `videos.list` to fill in duration and
   * category for the whole page. The second is what lets a hit be scored on more than its title —
   * `search.list` reports neither — and costs one unit against the search's hundred.
   *
   * Restricted to `videoCategoryId=10` (Music) so the reaction videos, lyric slideshows and
   * hour-long mixes that dominate a bare music query never enter the ranking.
   *
   * @param criteria - Title (mandatory) plus optional artist/album
   * @returns Every distinct video seen across the attempted queries, sorted by descending score
   */
  public async searchTracks(criteria: YoutubeTrackSearchCriteria): Promise<YoutubeTrackMatch[]> {
    if (!criteria.title || !criteria.title.trim()) {
      throw new Error('A track title is required to search YouTube.');
    }

    const limit = criteria.limit ?? DEFAULT_SEARCH_LIMIT;
    const matches = new Map<string, YoutubeTrackMatch>();

    for (const query of buildSearchQueries(criteria)) {
      this.logger.debug(`YouTube search: "${query}"`);

      let videoIds: string[];

      try {
        videoIds = await this.searchVideoIds(query, limit);
      } catch (error) {
        // A single over-specified query failing must not sink the fallbacks.
        this.logger.warn(`YouTube search failed for "${query}": ${getErrorMessage(error)}`);
        continue;
      }

      this.logger.debug(`  ${videoIds.length} hit(s) returned`);

      if (videoIds.length === 0) {
        continue;
      }

      const videos = await this.getVideos(videoIds);

      for (const video of videos) {
        const match = this.toTrackMatch(video, criteria, query);

        if (!match) {
          continue;
        }

        const previous = matches.get(match.id);

        // The same video can surface under several queries; keep its best score.
        if (!previous || match.score.total > previous.score.total) {
          matches.set(match.id, match);
        }
      }

      const bestSoFar = Math.max(0, ...[...matches.values()].map((match) => match.score.total));

      if (bestSoFar >= CONFIDENT_MATCH_SCORE) {
        this.logger.debug(`  confident match (${bestSoFar.toFixed(2)}), skipping broader queries`);
        break;
      }
    }

    return [...matches.values()].sort((left, right) => right.score.total - left.score.total);
  }

  /** Raw `search.list` restricted to music videos, reduced to the ids it found. */
  private async searchVideoIds(query: string, limit: number): Promise<string[]> {
    const response = await this.youtubeGet(
      '/search',
      {
        part: 'snippet',
        q: query,
        type: 'video',
        videoCategoryId: MUSIC_CATEGORY_ID,
        maxResults: String(Math.min(limit, VIDEO_DETAIL_BATCH)),
        order: 'relevance',
      },
      YoutubeListEnvelopeSchema,
    );

    return this.parseItems(response.items, YoutubeSearchItemSchema, 'search hit')
      .map((item) => item.id.videoId)
      .filter((videoId): videoId is string => !!videoId);
  }

  /**
   * Convenience wrapper over {@link searchTracks} returning the single best candidate, or `null`
   * when nothing scored above `minimumScore`.
   */
  public async findTrack(
    criteria: YoutubeTrackSearchCriteria,
    minimumScore: number = MINIMUM_MATCH_SCORE,
  ): Promise<YoutubeTrackMatch | null> {
    const [best] = await this.searchTracks(criteria);

    if (!best || best.score.total < minimumScore) {
      return null;
    }

    return best;
  }

  /**
   * Interprets one video into a ranked match.
   *
   * @returns `null` for anything that is not a playable recording — a live broadcast still going
   *   out, or a title that parsed to nothing. Both would otherwise be queued and stall MPD.
   */
  private toTrackMatch(
    video: YoutubeVideo,
    criteria: YoutubeTrackSearchCriteria,
    matchedQuery: string,
  ): YoutubeTrackMatch | null {
    const snippet = video.snippet;
    const videoTitle = snippet?.title ?? '';

    if (!videoTitle) {
      return null;
    }

    if (snippet?.liveBroadcastContent && snippet.liveBroadcastContent !== 'none') {
      this.logger.debug(`Skipping live broadcast ${video.id} ("${videoTitle}")`);
      return null;
    }

    const { artist, title } = parseVideoTitle(videoTitle, snippet?.channelTitle);

    if (!title) {
      return null;
    }

    const scorable = {
      title,
      artist,
      videoTitle,
      channelTitle: snippet?.channelTitle,
      isTopicChannel: isTopicChannel(snippet?.channelTitle),
      isMusicCategory: snippet?.categoryId === MUSIC_CATEGORY_ID,
    };

    return {
      id: video.id,
      title,
      artist,
      videoTitle,
      channelId: snippet?.channelId,
      channelTitle: snippet?.channelTitle,
      duration: parseIsoDuration(video.contentDetails?.duration),
      isMusicCategory: scorable.isMusicCategory,
      isTopicChannel: scorable.isTopicChannel,
      thumbnails: snippet?.thumbnails,
      score: scoreVideo(scorable, criteria),
      matchedQuery,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Playlists — the album mapping                                      */
  /* ------------------------------------------------------------------ */

  /** One playlist's own metadata, or `null` when it does not exist or is private. */
  public async getPlaylist(playlistId: string): Promise<YoutubePlaylistMatch | null> {
    if (!playlistId) {
      throw new Error('A playlist id is required.');
    }

    const response = await this.youtubeGet(
      '/playlists',
      { part: 'snippet,contentDetails', id: playlistId },
      YoutubeListEnvelopeSchema,
    );

    const [playlist] = this.parseItems(response.items, YoutubePlaylistSchema, 'playlist');

    if (!playlist) {
      return null;
    }

    return {
      id: playlist.id,
      title: playlist.snippet?.title ?? '',
      channelId: playlist.snippet?.channelId,
      channelTitle: playlist.snippet?.channelTitle,
      description: playlist.snippet?.description,
      itemCount: playlist.contentDetails?.itemCount,
      thumbnails: playlist.snippet?.thumbnails,
    };
  }

  /**
   * Searches for playlists rather than videos — the way an album is found by name.
   *
   * YouTube Music's auto-generated release playlists (ids beginning `OLAK5uy_`) are the closest
   * thing to a real album in the catalog: one per release, correct track order, no extras. They
   * rank alongside everything else here, so a caller after an album should prefer those ids.
   */
  public async searchPlaylists(query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<YoutubePlaylistMatch[]> {
    if (!query || !query.trim()) {
      throw new Error('A query is required to search YouTube playlists.');
    }

    const response = await this.youtubeGet(
      '/search',
      {
        part: 'snippet',
        q: query.trim(),
        type: 'playlist',
        maxResults: String(Math.min(limit, VIDEO_DETAIL_BATCH)),
        order: 'relevance',
      },
      YoutubeListEnvelopeSchema,
    );

    return this.parseItems(response.items, YoutubeSearchItemSchema, 'playlist hit')
      .filter((item) => !!item.id.playlistId)
      .map((item) => ({
        id: item.id.playlistId as string,
        title: item.snippet?.title ?? '',
        channelId: item.snippet?.channelId,
        channelTitle: item.snippet?.channelTitle,
        description: item.snippet?.description,
        thumbnails: item.snippet?.thumbnails,
      }));
  }

  /**
   * Every track of a playlist, in playlist order.
   *
   * Paged at 50 for one quota unit a page, so even a long playlist costs less than a single
   * search. Deleted and private entries are dropped: YouTube keeps them in the listing with the
   * title `Deleted video`, and they hold a position that would otherwise shift every track number
   * after them.
   */
  public async getPlaylistItems(playlistId: string, limit: number = Number.MAX_SAFE_INTEGER): Promise<YoutubePlaylistTrack[]> {
    if (!playlistId) {
      throw new Error('A playlist id is required.');
    }

    const tracks: YoutubePlaylistTrack[] = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string> = {
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: String(PLAYLIST_PAGE_SIZE),
      };

      if (pageToken) {
        params['pageToken'] = pageToken;
      }

      const response = await this.youtubeGet('/playlistItems', params, YoutubeListEnvelopeSchema);
      const items = this.parseItems(response.items, YoutubePlaylistItemSchema, 'playlist item');

      for (const item of items) {
        const snippet = item.snippet;
        const videoId = item.contentDetails?.videoId ?? snippet?.resourceId?.videoId;
        const rawTitle = snippet?.title ?? '';

        if (!videoId) {
          continue;
        }

        // YouTube leaves tombstones in the listing rather than removing the entry.
        if (rawTitle === 'Deleted video' || rawTitle === 'Private video') {
          this.logger.debug(`Skipping ${rawTitle.toLowerCase()} at position ${snippet?.position ?? '?'} of ${playlistId}`);
          continue;
        }

        // `videoOwnerChannelTitle` is the uploading channel; `channelTitle` is whoever owns the
        // playlist. On a release playlist the first is the artist and the second is YouTube Music.
        const ownerChannel = snippet?.videoOwnerChannelTitle;
        const { artist, title } = parseVideoTitle(rawTitle, ownerChannel);

        if (!title) {
          continue;
        }

        tracks.push({
          videoId,
          title,
          artist,
          videoTitle: rawTitle,
          trackNumber: (snippet?.position ?? tracks.length) + 1,
          channelId: snippet?.videoOwnerChannelId,
          channelTitle: ownerChannel,
          duration: 0,
          thumbnails: snippet?.thumbnails,
        });

        if (tracks.length >= limit) {
          return tracks;
        }
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    return tracks;
  }

  /* ------------------------------------------------------------------ */
  /* Account-scoped (OAuth)                                             */
  /* ------------------------------------------------------------------ */

  /**
   * The signed-in account's liked videos.
   *
   * `myRating=like` is the only way to reach them; there is no playlist id for the Likes list in
   * the v3 API. Requires OAuth.
   */
  public async getLikedVideos(limit: number = PLAYLIST_PAGE_SIZE): Promise<YoutubeVideo[]> {
    const videos: YoutubeVideo[] = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string> = {
        part: 'snippet,contentDetails',
        myRating: 'like',
        maxResults: String(Math.max(1, Math.min(limit - videos.length, PLAYLIST_PAGE_SIZE))),
      };

      if (pageToken) {
        params['pageToken'] = pageToken;
      }

      const response = await this.youtubeGet('/videos', params, YoutubeListEnvelopeSchema, 'oauth');
      videos.push(...this.parseItems(response.items, YoutubeVideoSchema, 'liked video'));

      pageToken = response.nextPageToken;
    } while (pageToken && videos.length < limit);

    return videos.slice(0, limit);
  }

  /** The signed-in account's own playlists, private ones included. Requires OAuth. */
  public async getMyPlaylists(limit: number = PLAYLIST_PAGE_SIZE): Promise<YoutubePlaylistMatch[]> {
    const playlists: YoutubePlaylistMatch[] = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string> = {
        part: 'snippet,contentDetails',
        mine: 'true',
        maxResults: String(Math.max(1, Math.min(limit - playlists.length, PLAYLIST_PAGE_SIZE))),
      };

      if (pageToken) {
        params['pageToken'] = pageToken;
      }

      const response = await this.youtubeGet('/playlists', params, YoutubeListEnvelopeSchema, 'oauth');

      for (const playlist of this.parseItems(response.items, YoutubePlaylistSchema, 'playlist')) {
        playlists.push({
          id: playlist.id,
          title: playlist.snippet?.title ?? '',
          channelId: playlist.snippet?.channelId,
          channelTitle: playlist.snippet?.channelTitle,
          description: playlist.snippet?.description,
          itemCount: playlist.contentDetails?.itemCount,
          thumbnails: playlist.snippet?.thumbnails,
        });
      }

      pageToken = response.nextPageToken;
    } while (pageToken && playlists.length < limit);

    return playlists.slice(0, limit);
  }

  /* ------------------------------------------------------------------ */
  /* Source building                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Builds the `SongSource` a YouTube video is attached to a song document as.
   *
   * `path` holds the Mopidy uri (`yt:video:<id>`) rather than the full proxy url, matching how the
   * Spotify source stores `spotify:track:<id>`: the proxy host is deployment configuration and
   * belongs in `YOUTUBE_PROXY_AUDIO`, not baked into every row of the database.
   */
  public buildYoutubeSource(videoId: string, title: string, duration: number = 0): SongSource {
    return {
      name: 'youtube',
      sourceId: videoId,
      path: `yt:video:${videoId}`,
      filename: title,
      technical_info: {
        ...YOUTUBE_TECHNICAL_DEFAULTS,
        duration,
      } as TechnicalInfo,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Import — playlist becomes album                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Imports one playlist as an album, with its videos as the tracks.
   *
   * The mapping, and why:
   *  - **playlist -> Album**, `sourceId` the playlist id. The only YouTube object with a title, an
   *    ordered track list, artwork and a stable id.
   *  - **channel -> Artist**, `sourceId` the channel id, with the ` - Topic` suffix stripped. The
   *    artist is taken from the *uploading* channel of the tracks rather than the playlist owner,
   *    because a release playlist is owned by YouTube Music and uploaded by the artist's channel.
   *    A playlist whose tracks disagree falls back to the playlist owner — that is a compilation,
   *    and no single artist is right, so the one the playlist is filed under wins.
   *  - **video -> Song**, `sourceId` the video id, `track_number` the playlist position.
   *
   * Like every importer here it never blindly inserts: each track is fuzzy-searched in OpenSearch
   * first, and a hit gets the YouTube source attached to the document it already has. That is what
   * makes a YouTube import add a *playable source* to the library rather than a parallel copy of
   * it — and it is the same reason dedup works across sources afterwards.
   *
   * @param playlistId - The `PL…` / `OLAK5uy_…` id
   * @param dryRun - Report what would be written without writing it
   */
  public async importPlaylist(playlistId: string, dryRun: boolean = false): Promise<YoutubeImportResult> {
    const playlist = await this.getPlaylist(playlistId);

    if (!playlist) {
      throw new Error(`YouTube has no playlist ${playlistId}, or it is private.`);
    }

    const tracks = await this.getPlaylistItems(playlistId);

    const result: YoutubeImportResult = {
      playlistId: playlist.id,
      playlistTitle: playlist.title,
      artistName: '',
      tracksSeen: tracks.length,
      songsCreated: 0,
      sourcesAttached: 0,
      alreadyPresent: 0,
      skipped: [],
    };

    if (tracks.length === 0) {
      this.logger.warn(`Playlist ${playlistId} ("${playlist.title}") holds no importable track.`);
      return result;
    }

    // Durations come from one batched videos.list rather than per-track lookups: 50 ids for one
    // quota unit, against one unit each if they were fetched singly.
    const durations = await this.fetchDurations(tracks.map((track) => track.videoId));

    const albumArtist = this.resolveAlbumArtist(playlist, tracks);
    const artistName = albumArtist.name;
    result.artistName = artistName;

    this.logger.log(
      `Importing playlist "${playlist.title}" as an album by "${artistName}" (${tracks.length} track(s))${dryRun ? ' [DRY RUN]' : ''}`,
    );

    if (dryRun) {
      for (const track of tracks) {
        this.logger.log(`  ${track.trackNumber}. ${track.artist || artistName} - ${track.title} (${track.videoId})`);
      }
      return result;
    }

    const artistDoc = await this.resolveArtistDocument(artistName, albumArtist.channelId);
    const albumDoc = await this.resolveAlbumDocument(playlist, artistDoc);

    for (const track of tracks) {
      try {
        const duration = durations.get(track.videoId) ?? 0;
        const source = this.buildYoutubeSource(track.videoId, track.title, duration);

        // 1. Exact match on an existing youtube source: nothing to do.
        const existingBySource = await this.songModel.exists({
          'source.name': 'youtube',
          'source.sourceId': track.videoId,
        });

        if (existingBySource) {
          result.alreadyPresent++;
          continue;
        }

        // 2. The song may already be in the library from another source. Attach rather than insert.
        const existingSong = await this.findExistingSong({
          title: track.title,
          artist: track.artist || artistName,
          album: stripReleasePrefix(playlist.title),
          track_number: track.trackNumber,
          disc_number: 1,
          year: '',
        });

        if (existingSong) {
          existingSong.source = existingSong.source ?? [];
          existingSong.source.push(source);
          await existingSong.save();
          result.sourcesAttached++;
          this.logger.debug(`Added youtube source to existing song: ${existingSong.title}`);

          if (!albumDoc.tracks.includes(existingSong._id as unknown as Song)) {
            albumDoc.tracks.push(existingSong._id as unknown as Song);
            await albumDoc.save();
          }

          continue;
        }

        // 3. Genuinely new.
        const songDoc = new this.songModel({
          title: track.title,
          artist: artistDoc._id,
          album: albumDoc._id,
          album_artist: artistName,
          track_number: track.trackNumber,
          disc_number: 1,
          category: 'Music',
          source: [source],
          created_by: 'youtube',
        });

        await songDoc.save();
        result.songsCreated++;
        this.logger.debug(`Created new song: ${songDoc.title}`);

        if (!albumDoc.tracks.includes(songDoc._id as unknown as Song)) {
          albumDoc.tracks.push(songDoc._id as unknown as Song);
          await albumDoc.save();
        }

        await this.indexSong(songDoc);
      } catch (error) {
        const message = `${track.title} (${track.videoId}): ${getErrorMessage(error)}`;
        this.logger.error(`Failed to import ${message}`);
        result.skipped.push(message);
      }
    }

    this.logger.log(
      `Playlist "${playlist.title}" done — ${result.songsCreated} created, ${result.sourcesAttached} source(s) attached, ` +
        `${result.alreadyPresent} already present, ${result.skipped.length} failed.`,
    );

    return result;
  }

  /** Durations for a set of videos, keyed by id. Best-effort: a failure costs the durations only. */
  private async fetchDurations(videoIds: string[]): Promise<Map<string, number>> {
    const durations = new Map<string, number>();

    try {
      for (const video of await this.getVideos(videoIds)) {
        durations.set(video.id, parseIsoDuration(video.contentDetails?.duration));
      }
    } catch (error) {
      this.logger.warn(`Could not read track durations for the playlist: ${getErrorMessage(error)}`);
    }

    return durations;
  }

  /**
   * Which artist a playlist belongs to — **name and channel id together**.
   *
   * The two must come from the same decision, and originally they did not: the name was taken from
   * the dominant uploading channel while the id passed alongside it was the playlist *owner*. On an
   * auto-generated release playlist the owner is YouTube Music, whose channel id is the same
   * `UCBR8-60-B28hp2BmDPdntcQ` for every such playlist in existence — so the second import matched
   * the artist document the first had created and every album collapsed onto one artist, each
   * carrying a correct `album_artist` string over a wrong `artist` ref.
   *
   * The uploading channel wins when the tracks agree, because on a release playlist that is the
   * artist's own Topic channel. A playlist whose tracks come from many channels is a compilation,
   * and there the playlist owner is the only defensible answer — taken as a pair, so the id always
   * describes the same channel the name came from.
   */
  private resolveAlbumArtist(
    playlist: YoutubePlaylistMatch,
    tracks: YoutubePlaylistTrack[],
  ): { name: string; channelId?: string } {
    const counts = new Map<string, { count: number; channelId?: string }>();

    for (const track of tracks) {
      const name = normalizeChannelTitle(track.channelTitle) || track.artist;

      if (!name) {
        continue;
      }

      const entry = counts.get(name) ?? { count: 0, channelId: undefined };
      entry.count++;
      entry.channelId = entry.channelId ?? track.channelId;
      counts.set(name, entry);
    }

    const [dominant] = [...counts.entries()].sort((left, right) => right[1].count - left[1].count);

    if (dominant && dominant[1].count / tracks.length >= 0.6) {
      return { name: dominant[0], channelId: dominant[1].channelId };
    }

    const ownerName = normalizeChannelTitle(playlist.channelTitle);

    if (ownerName) {
      return { name: ownerName, channelId: playlist.channelId };
    }

    if (dominant) {
      return { name: dominant[0], channelId: dominant[1].channelId };
    }

    return { name: 'Unknown Artist', channelId: undefined };
  }

  /**
   * The artist document for this import, attaching a youtube source to whatever is already there.
   *
   * Same three-step shape as the Qobuz importer: exact source match, then a fuzzy lookup that
   * decorates an existing artist, then a create.
   */
  private async resolveArtistDocument(artistName: string, channelId?: string): Promise<ArtistDocument> {
    if (channelId) {
      const bySource = await this.artistModel.findOne({
        'source.name': 'youtube',
        'source.sourceId': channelId,
      });

      if (bySource) {
        return bySource;
      }
    }

    const existing = await this.findExistingArtist(artistName);

    if (existing) {
      const sourceExists = (existing.source ?? []).some(
        (source) => source.name === 'youtube' && source.sourceId === channelId,
      );

      if (channelId && !sourceExists) {
        existing.source = existing.source ?? [];
        existing.source.push({ name: 'youtube', sourceId: channelId });
        await existing.save();
        this.logger.debug(`Added youtube source to existing artist: ${existing.artist}`);
      }

      return existing;
    }

    const created = new this.artistModel({
      artist: artistName,
      primary_genres: [],
      albums: [],
      source: channelId ? [{ name: 'youtube', sourceId: channelId }] : [],
    });

    await created.save();
    this.logger.debug(`Created new artist: ${created.artist}`);

    return created;
  }

  /** The album document for the playlist, created or decorated, and linked to the artist. */
  private async resolveAlbumDocument(playlist: YoutubePlaylistMatch, artistDoc: ArtistDocument): Promise<AlbumDocument> {
    // The record's name, not the playlist's: an auto-generated release is titled `Album - Kid A`,
    // and that prefix would neither match the same album from another source nor read as a title.
    const albumTitle = stripReleasePrefix(playlist.title);

    const bySource = await this.albumModel.findOne({
      'source.name': 'youtube',
      'source.sourceId': playlist.id,
    });

    if (bySource) {
      return bySource;
    }

    const existing = await this.findExistingAlbum(albumTitle);

    if (existing) {
      const sourceExists = (existing.source ?? []).some(
        (source) => source.name === 'youtube' && source.sourceId === playlist.id,
      );

      if (!sourceExists) {
        existing.source = existing.source ?? [];
        existing.source.push({ name: 'youtube', sourceId: playlist.id });
        await existing.save();
        this.logger.debug(`Added youtube source to existing album: ${existing.title}`);
      }

      await this.linkAlbumToArtist(artistDoc, existing);

      return existing;
    }

    // The playlist thumbnail is the only artwork YouTube offers, and MPD cannot read a picture out
    // of a proxied stream — so if it is not written here the track plays with no cover at all.
    const cover = bestThumbnailUrl(playlist.thumbnails);

    const created = new this.albumModel({
      title: albumTitle,
      artist: artistDoc._id,
      track_count: playlist.itemCount,
      genre: [],
      description: playlist.description,
      image: cover ? { small: cover, thumbnail: cover, large: cover, back: '' } : undefined,
      tracks: [],
      source: [{ name: 'youtube', sourceId: playlist.id }],
    });

    await created.save();
    this.logger.debug(`Created new album: ${created.title}`);

    await this.linkAlbumToArtist(artistDoc, created);

    return created;
  }

  private async linkAlbumToArtist(artistDoc: ArtistDocument, albumDoc: AlbumDocument): Promise<void> {
    if (!artistDoc.albums.includes(albumDoc._id as Types.ObjectId)) {
      artistDoc.albums.push(albumDoc._id as Types.ObjectId);
      await artistDoc.save();
    }
  }

  /**
   * Puts a freshly created song into the OpenSearch index, so the next importer — or the next
   * `music dedup search` — can find it.
   *
   * The song is re-read with its refs populated rather than assembled from the pieces already in
   * hand: `indexSongs` spreads `toObject()` over the whole document, so handing it a literal would
   * index a row missing every field the literal does not name.
   *
   * Indexing failures are logged, never fatal: the song is in Mongo either way.
   */
  private async indexSong(songDoc: SongDocument): Promise<void> {
    try {
      const populated = await this.songModel
        .findById(songDoc._id)
        .populate('artist')
        .populate('album')
        .exec();

      if (!populated) {
        this.logger.warn(`Could not re-read song ${String(songDoc._id)} for indexing.`);
        return;
      }

      await this.opensearchService.indexSongs([populated as unknown as PopulatedSong]);
      this.logger.debug(`Indexed song ${songDoc.title} in OpenSearch.`);
    } catch (error) {
      this.logger.error(`Failed to index new song ${songDoc.title} in OpenSearch: ${getErrorMessage(error)}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Existing-entity lookups                                            */
  /* ------------------------------------------------------------------ */

  private async findExistingAlbum(albumName: string): Promise<AlbumDocument | null> {
    try {
      const searchResponse = await this.opensearchService.fuzzySearchAlbum(albumName);

      if (!searchResponse) {
        return null;
      }

      const hits = searchResponse.hits.hits as Array<{ _score: number; _source?: { album_id?: string } }>;

      if (!hits || hits.length === 0) {
        return null;
      }

      const bestHit = [...hits].sort((left, right) => right._score - left._score)[0];
      const albumId = bestHit?._source?.album_id;

      return albumId ? this.albumModel.findById(albumId) : null;
    } catch (error) {
      this.logger.warn(`Existing-album lookup failed for "${albumName}": ${getErrorMessage(error)}`);
      return null;
    }
  }

  private async findExistingArtist(artistName: string): Promise<ArtistDocument | null> {
    try {
      const searchResponse = await this.opensearchService.fuzzySearchArtist(artistName);

      if (!searchResponse) {
        return null;
      }

      const hits = searchResponse.hits.hits as Array<{ _score: number; _source?: { artist_id?: string } }>;

      if (!hits || hits.length === 0) {
        return null;
      }

      const bestHit = [...hits].sort((left, right) => right._score - left._score)[0];
      const artistId = bestHit?._source?.artist_id;

      return artistId ? this.artistModel.findById(artistId) : null;
    } catch (error) {
      this.logger.warn(`Existing-artist lookup failed for "${artistName}": ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * The song this track already is, if the library has it under another source.
   *
   * The score floor of 100 is the same one the Qobuz importer and `music dedup search` use for a
   * high-confidence match — attaching a source to the wrong document is worse than importing a
   * duplicate, because a merge can fix the duplicate and nothing detects the mis-attachment.
   */
  private async findExistingSong(attributes: Omit<DuplicateSongCheck, 'songId'>): Promise<SongDocument | null> {
    try {
      const searchResponse = await this.opensearchService.findDuplicatesSongs({
        songId: '',
        ...attributes,
      });

      if (!searchResponse) {
        return null;
      }

      const bestHit = searchResponse.hits.hits
        .filter((hit) => hit._score >= 100)
        .sort((left, right) => right._score - left._score)[0];

      return bestHit ? this.songModel.findById(bestHit._id) : null;
    } catch (error) {
      this.logger.warn(`Existing-song lookup failed for "${attributes.title}": ${getErrorMessage(error)}`);
      return null;
    }
  }
}
