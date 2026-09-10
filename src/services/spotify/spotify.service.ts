import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SpotifyWebApi from 'spotify-web-api-node';
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAuthUtil } from './spotify-auth.util';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { z } from 'zod';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { SongSource } from '../../schemas/source.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';
import { OpensearchService } from '../opensearch/opensearch.service';
import { AlbumImage, PopulatedSong } from '../music-db/music-db.service';
import { getErrorMessage } from '../../utils/error.utils';
import { describeSpotifyError } from './spotify-error.util';
import { OpenSearchAlbumSearchResponse, OpenSearchArtistSearchResponse, OpenSearchSearchResponse } from '../opensearch/types';
import {
  SpotifyAlbumMatch,
  SpotifyAlbumRef,
  SpotifyAlbumRefSchema,
  SpotifyAlbumTrack,
  SpotifyAlbumTrackSchema,
  SpotifyArtistCatalogCriteria,
  SpotifyArtistCatalogResult,
  SpotifyArtistHitSchema,
  SpotifyArtistMatch,
  SpotifyTrackHit,
  SpotifyTrackHitSchema,
  SpotifyTrackMatch,
  SpotifyTrackSearchCriteria,
} from './spotify.interfaces';
import {
  buildSearchQueries,
  describeParseFailure,
  getTrackArtistName,
  isPlausibleMatch,
  MATCH_FLOOR,
  scoreTrack,
  trackBelongsToArtist,
} from './spotify-track-match.util';
import { identitySimilarity } from '../../utils/text-match.utils';

/** What `.spotify-session.json` holds; anything else in the file is ignored. */
const SpotifySessionSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expirationTime: z.number().optional(),
});

/** Hits scoring below this are not returned by {@link SpotifyService.findTrack}. */
const MINIMUM_MATCH_SCORE = 0.6;

/** Once a hit reaches this score, trying the broader fallback queries is pointless. */
const CONFIDENT_MATCH_SCORE = 0.9;

/**
 * The most Spotify hands back per page to an app in Development Mode — the documented 50 is for
 * apps past the extended-quota review, and this one is not. Anything above 10 is `HTTP 400
 * Invalid limit`, on search and on the artist albums listing alike. The quota is tight too: a
 * burst of a dozen calls answers `429 QUOTA_EXCEEDED`, which is why every listing pages
 * lazily and stops as soon as it has what it needs.
 */
const SEARCH_PAGE_CEILING = 10;

/** Hits requested per search query when the caller does not say. */
const DEFAULT_SEARCH_LIMIT = SEARCH_PAGE_CEILING;

/** Artist hits requested per search. A handful is plenty to disambiguate a name. */
const DEFAULT_ARTIST_SEARCH_LIMIT = SEARCH_PAGE_CEILING;

/** Releases pulled back with an artist page, across several pages. Enough for a discography. */
const DEFAULT_ARTIST_ALBUM_LIMIT = 30;

/** Below this an entry in the artist's own discography is not the album that was asked for. */
const ALBUM_TITLE_FLOOR = MATCH_FLOOR.album;

/**
 * Resolves the market to the signed-in account's country. Every call here runs on the user's
 * token, and without a market Spotify neither relinks region-locked tracks nor reports
 * `is_playable`, so a hit could be queued and then refuse to stream.
 */
const MARKET_FROM_TOKEN = 'from_token';

/**
 * What a Spotify stream is, technically.
 *
 * The API reports nothing about the audio — it describes tracks, not renditions — so this is what
 * the playback backend delivers on a Premium account: 320 kbps Ogg Vorbis at 44.1 kHz. The values
 * matter beyond bookkeeping: `PlayMusicHandler.getBestSource` scores sources by exactly these
 * fields, and the negentropy pass decides from them whether a queued file is worth replacing with
 * this stream. `is_cd_quality: false` keeps it under every lossless source; the bitrate is what
 * puts it over YouTube's 256 kbps and over the library's 128/192 kbps mp3s, and *level* with a
 * 320 kbps mp3 — which is why such a file is never swapped for it.
 */
export const SPOTIFY_TECHNICAL_DEFAULTS = {
  bitrate: 320000,
  sample_rate: 44100,
  bit_depth: 16,
  is_high_res: false,
  is_cd_quality: false,
  extension: 'ogg',
  encoding: 'vorbis',
} as const;

@Injectable()
export class SpotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpotifyService.name);
  private spotifyApi!: SpotifyWebApi;
  public auth!: SpotifyAuthUtil;
  private refreshInterval: NodeJS.Timeout | null = null;
  private currentExpirationTime: number | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly opensearchService: OpensearchService,
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {}

  public onModuleInit(): void {
    const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('SPOTIFY_REDIRECT_URL');

    this.spotifyApi = new SpotifyWebApi({
      clientId,
      clientSecret,
      redirectUri,
    });

    const sessionPath = path.join(process.cwd(), '.spotify-session.json');
    if (fs.existsSync(sessionPath)) {
      try {
        const data = fs.readFileSync(sessionPath, 'utf8');
        const session = SpotifySessionSchema.parse(JSON.parse(data));
        if (session.accessToken) {
          this.spotifyApi.setAccessToken(session.accessToken);
        }
        if (session.refreshToken) {
          this.spotifyApi.setRefreshToken(session.refreshToken);
        }
        if (session.expirationTime) {
          this.currentExpirationTime = session.expirationTime;
        }

        // Start token refresh interval and check immediately
        this.startTokenRefreshInterval();
      } catch (error) {
        this.logger.error(`Error loading Spotify session: ${getErrorMessage(error)}`);
      }
    } else {
      this.logger.warn('Spotify session data (.spotify-session.json) is missing. Please authenticate first by running the auth CLI command.');
    }

    this.auth = new SpotifyAuthUtil(this.spotifyApi, this.configService);
  }

  public getClient(): SpotifyWebApi {
    return this.spotifyApi;
  }

  public onModuleDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  public async refreshToken(): Promise<void> {
    try {
      if (!this.spotifyApi.getRefreshToken()) return;
      this.logger.log('Refreshing Spotify access token...');
      const data = await this.spotifyApi.refreshAccessToken();
      const newAccessToken = data.body.access_token;
      const newExpiresIn = data.body.expires_in;
      const newExpirationTime = Date.now() + newExpiresIn * 1000;

      this.spotifyApi.setAccessToken(newAccessToken);
      this.currentExpirationTime = newExpirationTime;

      const sessionPath = path.join(process.cwd(), '.spotify-session.json');
      const sessionData = {
        accessToken: newAccessToken,
        refreshToken: this.spotifyApi.getRefreshToken(),
        expirationTime: newExpirationTime,
      };
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf8');
      this.logger.log('Spotify access token refreshed successfully.');
    } catch (error) {
      const errorMessage = describeSpotifyError(error);
      this.logger.error(`Failed to refresh Spotify access token: ${errorMessage}`);
    }
  }

  private startTokenRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // Check immediately if we need to refresh (if missing or already expired/close to expiry)
    const checkRefresh = () => {
      // If we don't have an expiration time but we have a refresh token, refresh it just to be safe
      if (!this.currentExpirationTime && this.spotifyApi.getRefreshToken()) {
        void this.refreshToken();
        return;
      }

      if (this.currentExpirationTime) {
        const timeRemaining = this.currentExpirationTime - Date.now();
        // Refresh if within 5 minutes of expiring
        if (timeRemaining < 5 * 60 * 1000) {
          void this.refreshToken();
        }
      }
    };

    checkRefresh();

    // Then check every 1 minute
    this.refreshInterval = setInterval(checkRefresh, 60 * 1000);
  }

  public async searchSongs(query: string, limit: number = 20): Promise<SpotifyApi.PagingObject<SpotifyApi.TrackObjectFull> | undefined> {
    try {
      const result = await this.spotifyApi.searchTracks(query, { limit });
      return result.body.tracks;
    } catch (error) {
      const errorMessage = describeSpotifyError(error);
      this.logger.error(`Error searching songs: ${errorMessage}`);
      throw error;
    }
  }

  public async listUserLibrary(limit: number = 20, offset: number = 0): Promise<SpotifyApi.UsersSavedTracksResponse> {
    try {
      // getMySavedTracks requires user authentication
      const result = await this.spotifyApi.getMySavedTracks({ limit, offset });
      return result.body;
    } catch (error) {
      const errorMessage = describeSpotifyError(error);
      this.logger.error(`Error listing user library: ${errorMessage}`);
      throw error;
    }
  }

  public async createPlaylist(name: string, description?: string, isPublic: boolean = false): Promise<SpotifyApi.CreatePlaylistResponse> {
    try {
      const result = await this.spotifyApi.createPlaylist(name, {
        description,
        public: isPublic,
      });
      return result.body;
    } catch (error) {
      const errorMessage = describeSpotifyError(error);
      this.logger.error(`Error creating playlist: ${errorMessage}`);
      throw error;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Catalog — search, lookup, artist-locked lookup                     */
  /* ------------------------------------------------------------------ */

  /**
   * Parses a page of SDK items through the schema of the boundary, dropping and logging the ones
   * that no longer fit rather than failing the whole page.
   */
  private parseItems<T>(items: unknown[], schema: z.ZodSchema<T>, context: string): T[] {
    const parsed: T[] = [];

    for (const item of items) {
      const result = schema.safeParse(item);

      if (!result.success) {
        // Not a "nothing found": a real result is being thrown away, which is worth a warning.
        this.logger.warn(`Discarding a Spotify ${context} the schema no longer accepts: ${describeParseFailure(item, result.error)}`);
        continue;
      }

      parsed.push(result.data);
    }

    return parsed;
  }

  /**
   * Searches the Spotify catalog for a track, ranked best-match first.
   *
   * Queries are tried from most to least specific (`buildSearchQueries`) and the loop stops early
   * once a hit is confident enough, which keeps the common case to a single API call while still
   * recovering when one of the criteria is slightly off. Hits Spotify marks unplayable in the
   * account's market are dropped along with the ones failing a stated criterion.
   *
   * @param criteria - Title (mandatory) plus optional artist/album
   * @returns Every distinct track seen across the attempted queries, sorted by descending score
   */
  public async searchTracks(criteria: SpotifyTrackSearchCriteria): Promise<SpotifyTrackMatch[]> {
    if (!criteria.title || !criteria.title.trim()) {
      throw new Error('A track title is required to search the Spotify catalog.');
    }

    const limit = Math.min(criteria.limit ?? DEFAULT_SEARCH_LIMIT, SEARCH_PAGE_CEILING);
    const matches = new Map<string, SpotifyTrackMatch>();

    for (const query of buildSearchQueries(criteria)) {
      this.logger.debug(`Spotify catalog search: ${query}`);

      let items: unknown[];

      try {
        const response = await this.spotifyApi.searchTracks(query, { limit, market: MARKET_FROM_TOKEN });
        items = response.body.tracks?.items ?? [];
      } catch (error) {
        // A single over-specified query failing must not sink the fallbacks.
        this.logger.warn(`Spotify catalog search failed for ${query}: ${describeSpotifyError(error)}`);
        continue;
      }

      this.logger.debug(`  ${items.length} hit(s) returned`);

      for (const track of this.parseItems(items, SpotifyTrackHitSchema, 'track hit')) {
        const match = this.toTrackMatch(track, criteria, query);
        const previous = matches.get(match.id);

        // The same track can surface under several queries; keep its best score.
        if (!previous || match.score.total > previous.score.total) {
          matches.set(match.id, match);
        }
      }

      // Only a hit that actually satisfies the criteria may end the search.
      const plausible = this.keepPlausible([...matches.values()], criteria);
      const bestSoFar = Math.max(0, ...plausible.map((match) => match.score.total));

      if (bestSoFar >= CONFIDENT_MATCH_SCORE) {
        this.logger.debug(`  confident match (${bestSoFar.toFixed(2)}), skipping broader queries`);
        break;
      }
    }

    const found = [...matches.values()].sort((left, right) => right.score.total - left.score.total);

    if (criteria.includeRejected) {
      return found;
    }

    const kept = this.keepPlausible(found, criteria);

    if (kept.length < found.length) {
      this.logger.debug(`  dropped ${found.length - kept.length} of ${found.length} hit(s) failing a stated criterion`);
    }

    return kept;
  }

  /** The hits that satisfy every criterion the caller stated, and that can actually be streamed. */
  private keepPlausible(matches: SpotifyTrackMatch[], criteria: SpotifyTrackSearchCriteria): SpotifyTrackMatch[] {
    return matches.filter((match) => match.playable && isPlausibleMatch(match.score, criteria));
  }

  /**
   * Convenience wrapper over {@link searchTracks} returning the single best candidate, or `null`
   * when nothing scored above `minimumScore`.
   */
  public async findTrack(criteria: SpotifyTrackSearchCriteria, minimumScore: number = MINIMUM_MATCH_SCORE): Promise<SpotifyTrackMatch | null> {
    const [best] = await this.searchTracks(criteria);

    if (!best || best.score.total < minimumScore) {
      return null;
    }

    return best;
  }

  private toTrackMatch(track: SpotifyTrackHit, criteria: SpotifyTrackSearchCriteria, matchedQuery: string): SpotifyTrackMatch {
    return {
      id: track.id,
      title: track.name,
      artist: getTrackArtistName(track),
      artists: track.artists,
      album: track.album.name,
      albumId: track.album.id,
      duration: Math.round(track.duration_ms / 1000),
      explicit: track.explicit ?? false,
      playable: track.is_playable ?? true,
      albumImage: track.album.images[0]?.url,
      score: scoreTrack(track, criteria),
      matchedQuery,
      track,
    };
  }

  /** One track by id, for playback of an id the model or the user already holds. */
  public async getTrack(trackId: string): Promise<SpotifyTrackHit> {
    const response = await this.spotifyApi.getTrack(trackId, { market: MARKET_FROM_TOKEN });

    return SpotifyTrackHitSchema.parse(response.body);
  }

  /**
   * One album with its full tracklist, paged past the 50 tracks the album call embeds.
   */
  public async getAlbum(albumId: string): Promise<{ album: SpotifyAlbumRef; tracks: SpotifyAlbumTrack[] }> {
    const response = await this.spotifyApi.getAlbum(albumId, { market: MARKET_FROM_TOKEN });
    const raw: unknown = response.body;
    const album = SpotifyAlbumRefSchema.parse(raw);

    const embedded = (raw as { tracks?: { items?: unknown[]; total?: number } }).tracks;
    const tracks = this.parseItems(embedded?.items ?? [], SpotifyAlbumTrackSchema, 'album track');
    const total = embedded?.total ?? tracks.length;

    let offset = tracks.length;

    while (offset < total) {
      const page = await this.spotifyApi.getAlbumTracks(albumId, { limit: SEARCH_PAGE_CEILING, offset, market: MARKET_FROM_TOKEN });
      const items = page.body.items ?? [];

      if (items.length === 0) break;

      tracks.push(...this.parseItems(items, SpotifyAlbumTrackSchema, 'album track'));
      offset += items.length;
    }

    return { album, tracks };
  }

  /**
   * Searches the Spotify catalog for an artist by name, best match first.
   *
   * Nothing to score here: Spotify already ranks artist hits by relevance, and a name is either
   * right or it is not. An empty array means the catalog holds no such artist, which callers must
   * treat as final rather than retrying with another spelling.
   */
  public async searchArtists(query: string, limit: number = DEFAULT_ARTIST_SEARCH_LIMIT): Promise<SpotifyArtistMatch[]> {
    if (!query || !query.trim()) {
      throw new Error('An artist name is required to search the Spotify catalog.');
    }

    const response = await this.spotifyApi.searchArtists(query.trim(), { limit: Math.min(limit, SEARCH_PAGE_CEILING) });
    const items: unknown[] = response.body.artists?.items ?? [];

    return this.parseItems(items, SpotifyArtistHitSchema, 'artist hit').map((artist) => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres,
      followers: artist.followers?.total ?? undefined,
      picture: artist.images[0]?.url,
    }));
  }

  /**
   * The discography of an artist: albums, singles and compilations they are credited on.
   *
   * Best-effort by design: this only ever decorates an artist that has already been found, so a
   * failure returns an empty discography rather than sinking the lookup.
   */
  public async getArtistAlbums(artistId: string, limit: number = DEFAULT_ARTIST_ALBUM_LIMIT): Promise<SpotifyAlbumMatch[]> {
    const albums: SpotifyAlbumMatch[] = [];

    try {
      let offset = 0;

      while (albums.length < limit) {
        const response = await this.spotifyApi.getArtistAlbums(artistId, {
          include_groups: 'album,single,compilation',
          limit: Math.min(limit - albums.length, SEARCH_PAGE_CEILING),
          offset,
          country: MARKET_FROM_TOKEN,
        });
        const items: unknown[] = response.body.items ?? [];

        albums.push(...this.parseItems(items, SpotifyAlbumRefSchema, 'artist album').map((album) => this.toAlbumMatch(album)));
        offset += items.length;

        if (items.length === 0 || !response.body.next) break;
      }
    } catch (error) {
      // Whatever was read before the failure is still a discography worth reporting.
      this.logger.warn(`Could not read the whole Spotify discography of artist ${artistId}: ${describeSpotifyError(error)}`);
    }

    return albums;
  }

  private toAlbumMatch(album: SpotifyAlbumRef): SpotifyAlbumMatch {
    return {
      id: album.id,
      title: album.name,
      type: album.album_type ?? 'album',
      releaseDate: album.release_date,
      trackCount: album.total_tracks,
      image: album.images[0]?.url,
      artists: album.artists,
    };
  }

  /**
   * Looks a recording up **locked to one artist**: the name is resolved to a Spotify artist id
   * first, and nothing that is not that artist's can come back.
   *
   * Two routes, both anchored on the artist id, mirroring `QobuzService.searchArtistCatalog`:
   * - **With an album**, the album is resolved against the artist's own discography and its
   *   tracklist is read straight off the album. No fuzzy track matching happens at all.
   * - **Without one**, the search runs with the `artist:` filter, and every hit is then verified
   *   against the artist id rather than against the spelling of a name — the filter is a text
   *   match over the credits, and "Spice" still pulls in "Spice Girls".
   */
  public async searchArtistCatalog(criteria: SpotifyArtistCatalogCriteria): Promise<SpotifyArtistCatalogResult> {
    if (!criteria.artist || !criteria.artist.trim()) {
      throw new Error('An artist name is required to search the Spotify catalog by artist.');
    }

    const artistName = criteria.artist.trim();
    const candidates = await this.searchArtists(artistName, DEFAULT_ARTIST_SEARCH_LIMIT);

    if (candidates.length === 0) {
      this.logger.debug(`No Spotify artist named "${artistName}"`);
      return { artist: null, candidates: [], albums: [], tracks: [], source: 'none' };
    }

    const artist = this.pickArtist(candidates, artistName);
    const albums = await this.getArtistAlbums(artist.id);

    this.logger.debug(`Locked on Spotify artist ${artist.name} (${artist.id}), ${albums.length} release(s)`);

    if (criteria.album?.trim()) {
      return this.tracksFromArtistAlbum(artist, candidates, albums, criteria);
    }

    if (criteria.title?.trim()) {
      return this.tracksFromLockedSearch(artist, candidates, albums, criteria);
    }

    return { artist, candidates, albums, tracks: [], source: 'none' };
  }

  /**
   * The best of the artist hits Spotify returned. Spotify ranks by popularity, which puts a busier
   * artist above an exact namesake often enough to matter. An exact name wins; short of that,
   * Spotify's own order stands.
   */
  private pickArtist(candidates: SpotifyArtistMatch[], artistName: string): SpotifyArtistMatch {
    let best = candidates[0];
    let bestScore = identitySimilarity(artistName, best.name);

    for (const candidate of candidates.slice(1)) {
      const score = identitySimilarity(artistName, candidate.name);

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  /** The album route: resolve the title against the discography, then read its tracklist. */
  private async tracksFromArtistAlbum(
    artist: SpotifyArtistMatch,
    candidates: SpotifyArtistMatch[],
    albums: SpotifyAlbumMatch[],
    criteria: SpotifyArtistCatalogCriteria,
  ): Promise<SpotifyArtistCatalogResult> {
    const wanted = criteria.album!.trim();
    let matchedAlbum: SpotifyAlbumMatch | undefined;
    let albumScore = 0;

    for (const album of albums) {
      const score = identitySimilarity(wanted, album.title);

      if (score > albumScore) {
        matchedAlbum = album;
        albumScore = score;
      }
    }

    if (!matchedAlbum || albumScore < ALBUM_TITLE_FLOOR) {
      this.logger.debug(`No release like "${wanted}" in the Spotify discography of ${artist.name}`);
      return { artist, candidates, albums, tracks: [], source: 'none' };
    }

    this.logger.debug(`Album "${wanted}" resolved to "${matchedAlbum.title}" (${matchedAlbum.id}, ${albumScore.toFixed(2)})`);

    let detail: { album: SpotifyAlbumRef; tracks: SpotifyAlbumTrack[] };

    try {
      detail = await this.getAlbum(matchedAlbum.id);
    } catch (error) {
      this.logger.warn(`Could not read Spotify album ${matchedAlbum.id}: ${describeSpotifyError(error)}`);
      return { artist, candidates, albums, matchedAlbum, albumScore, tracks: [], source: 'none' };
    }

    // A tracklist item carries no album block of its own, so give it the one it came from.
    const items: SpotifyTrackHit[] = detail.tracks.map((track) => ({ ...track, album: detail.album }));

    // Scoring a tracklist against the album it *is* would be circular, so the criteria used here
    // are the ones that were genuinely in question: the title, when one was asked for.
    const scored = items.map((track) =>
      this.toTrackMatch(track, { title: criteria.title?.trim() || track.name, artist: artist.name }, `album:${matchedAlbum.id}`),
    );

    // Without a title the whole record is the answer, in running order.
    const tracks = criteria.title?.trim()
      ? scored.filter((match) => match.score.title >= MATCH_FLOOR.title).sort((left, right) => right.score.title - left.score.title)
      : scored;

    return {
      artist,
      candidates,
      albums,
      matchedAlbum,
      albumScore,
      tracks: criteria.limit ? tracks.slice(0, criteria.limit) : tracks,
      source: 'album',
    };
  }

  /** The title-only route: the filtered search, with every hit verified against the id. */
  private async tracksFromLockedSearch(
    artist: SpotifyArtistMatch,
    candidates: SpotifyArtistMatch[],
    albums: SpotifyAlbumMatch[],
    criteria: SpotifyArtistCatalogCriteria,
  ): Promise<SpotifyArtistCatalogResult> {
    const found = await this.searchTracks({
      title: criteria.title!.trim(),
      artist: artist.name,
      limit: criteria.limit,
    });

    const tracks = found.filter((match) => trackBelongsToArtist(match.track, artist));

    this.logger.debug(`${tracks.length} of ${found.length} hit(s) are actually by ${artist.name}`);

    return { artist, candidates, albums, tracks, source: tracks.length > 0 ? 'catalog' : 'none' };
  }

  /**
   * The album artwork a track or album hit carries, in the shape the album document stores.
   * Spotify lists images widest first; the library wants large, small and thumbnail.
   */
  public toAlbumImage(album: SpotifyAlbumRef): AlbumImage {
    const [large, small, thumbnail] = album.images.map((image) => image.url);

    return {
      large,
      small: small ?? large,
      thumbnail: thumbnail ?? small ?? large,
    };
  }

  public async importLikedSongs(dryRun: boolean = false, limitParam?: number): Promise<void> {
    this.logger.log(`Starting import of Spotify liked songs${dryRun ? ' (DRY RUN)' : ''}...`);
    try {
      const limit = 50; // max allowed by Spotify API for a single request
      let offset = 0;
      let total = 0;
      let importedCount = 0;
      const stats = {
        artists: { created: 0, updated: 0, existed: 0 },
        albums: { created: 0, updated: 0, existed: 0 },
        songs: { created: 0, updated: 0, existed: 0 },
      };

      do {
        const response = await this.listUserLibrary(limit, offset);

        if (!response || !response.items) {
          throw new Error('Invalid response from Spotify API');
        }

        for (const item of response.items) {
          const track = item.track;
          if (!track) continue;

          try {
            const trackSpotifyId = track.id;
            const existingSong = await this.songModel.exists({
              'source.name': 'spotify',
              'source.sourceId': trackSpotifyId,
            });

            if (existingSong) {
              this.logger.debug(`Song already imported from Spotify: ${track.name} (${trackSpotifyId})`);
              stats.songs.existed++;
              importedCount++;
              continue; // Optimization: If we already have the exact song by spotify ID, skip.
            }

            this.logger.debug(`Processing track: ${track.name} (${track.id})`);
            const result = await this.importTrack(track, dryRun);
            if (result) {
              if (result.artist === 'created') stats.artists.created++;
              else if (result.artist === 'updated') stats.artists.updated++;
              else if (result.artist === 'none') stats.artists.existed++;

              if (result.album === 'created') stats.albums.created++;
              else if (result.album === 'updated') stats.albums.updated++;
              else if (result.album === 'none') stats.albums.existed++;

              if (result.song === 'created') stats.songs.created++;
              else if (result.song === 'updated') stats.songs.updated++;
              else if (result.song === 'none') stats.songs.existed++;
            }
            importedCount++;
          } catch (trackError) {
            const errMessage = describeSpotifyError(trackError);
            this.logger.error(`Failed to import track ${track.id}: ${errMessage}`);
          }

          if (limitParam !== undefined && importedCount >= limitParam) {
            break;
          }
        }

        total = response.total;
        offset += limit;
      } while (offset < total && (limitParam === undefined || importedCount < limitParam));

      this.logger.log(`\nImport Statistics${dryRun ? ' (DRY RUN)' : ''}:`);
      this.logger.log(`Processed Tracks: ${importedCount}`);
      this.logger.log(`Artists -> Created: ${stats.artists.created}, Updated: ${stats.artists.updated}, Existed: ${stats.artists.existed}`);
      this.logger.log(`Albums  -> Created: ${stats.albums.created}, Updated: ${stats.albums.updated}, Existed: ${stats.albums.existed}`);
      this.logger.log(`Songs   -> Created: ${stats.songs.created}, Updated: ${stats.songs.updated}, Existed: ${stats.songs.existed}`);
    } catch (error) {
      const errorMessage = describeSpotifyError(error);
      this.logger.error(`Failed to import liked songs: ${errorMessage}`);
    }
  }

  private async importTrack(
    track: SpotifyApi.TrackObjectFull,
    dryRun: boolean,
  ): Promise<{ artist: 'created' | 'updated' | 'none'; album: 'created' | 'updated' | 'none'; song: 'created' | 'updated' | 'none' } | null> {
    const artistSpotifyId = track.artists[0]?.id;
    const artistName = track.artists[0]?.name;

    if (!artistSpotifyId || !artistName) {
      this.logger.warn(`Track ${track.name} has no primary artist info.`);
      return null;
    }

    // 1. Search phase
    let artistDoc = await this.resolveExistingArtist(artistSpotifyId, artistName);
    let albumDoc = await this.resolveExistingAlbum(track.album.id, track.album.name);
    const songDoc = await this.resolveExistingSong(track.id, track, artistDoc, albumDoc);

    // 2. Creation / Update phase
    const artistResult = await this.createOrUpdateArtist(artistDoc, artistSpotifyId, artistName, dryRun);
    artistDoc = artistResult.doc;

    const albumResult = await this.createOrUpdateAlbum(albumDoc, track.album, artistDoc, dryRun);
    albumDoc = albumResult.doc;

    const songResult = await this.createOrUpdateSong(songDoc, track, artistDoc, albumDoc, dryRun);

    return {
      artist: artistResult.action,
      album: albumResult.action,
      song: songResult.action,
    };
  }

  private async resolveExistingArtist(spotifyId: string, name: string): Promise<ArtistDocument | null> {
    this.logger.debug(`Checking if artist exists by Spotify ID: ${spotifyId}`);
    const artistDoc = await this.artistModel.findOne({
      'source.name': 'spotify',
      'source.sourceId': spotifyId,
    });
    if (artistDoc) {
      this.logger.debug(`Found artist by Spotify ID: "${artistDoc.artist}" (ID: ${artistDoc._id.toString()})`);
      return artistDoc;
    }

    this.logger.log(`Artist not found by ID. Checking OpenSearch for fuzzy match on name: "${name}"`);
    const existingArtistId = await this.findExistingEntityId('artist', name);
    const existingArtist = existingArtistId ? await this.artistModel.findById(existingArtistId) : null;
    if (existingArtist) {
      this.logger.log(`Found existing artist via OpenSearch: "${existingArtist.artist}" (ID: ${existingArtist._id.toString()})`);
      return existingArtist;
    }

    return null;
  }

  private async resolveExistingAlbum(spotifyId: string, title: string): Promise<AlbumDocument | null> {
    this.logger.debug(`Checking if album exists by Spotify ID: ${spotifyId}`);
    const albumDoc = await this.albumModel.findOne({
      'source.name': 'spotify',
      'source.sourceId': spotifyId,
    });
    if (albumDoc) {
      this.logger.debug(`Found album by Spotify ID: "${albumDoc.title}" (ID: ${albumDoc._id.toString()})`);
      return albumDoc;
    }

    this.logger.log(`Album not found by ID. Checking OpenSearch for fuzzy match on title: "${title}"`);
    const existingAlbumId = await this.findExistingEntityId('album', title);
    const existingAlbum = existingAlbumId ? await this.albumModel.findById(existingAlbumId) : null;
    if (existingAlbum) {
      this.logger.log(`Found existing album via OpenSearch: "${existingAlbum.title}" (ID: ${existingAlbum._id.toString()})`);
      return existingAlbum;
    }

    return null;
  }

  private async resolveExistingSong(
    spotifyId: string,
    track: SpotifyApi.TrackObjectFull,
    artistDoc: ArtistDocument | null,
    albumDoc: AlbumDocument | null,
  ): Promise<SongDocument | null> {
    this.logger.debug(`Checking if song exists by Spotify ID: ${spotifyId}`);
    const songDoc = await this.songModel.findOne({
      'source.name': 'spotify',
      'source.sourceId': spotifyId,
    });
    if (songDoc) {
      this.logger.debug(`Found song by Spotify ID: "${songDoc.title}" (ID: ${songDoc._id.toString()})`);
      return songDoc;
    }

    const artistIdStr = artistDoc?._id?.toString() || null;
    const albumIdStr = albumDoc?._id?.toString() || null;
    const artistName = artistDoc?.artist || track.artists[0]?.name || '';
    const albumName = albumDoc?.title || track.album.name || '';

    this.logger.log(
      `Song not found by ID. Checking OpenSearch for fuzzy match on title: "${track.name}", artist ID: "${artistIdStr}", album ID: "${albumIdStr}"`,
    );
    const existingSongId = await this.findExistingEntityId('song', track.name, {
      artistName,
      albumName,
      artistId: artistIdStr,
      albumId: albumIdStr,
    });
    const existingSong = existingSongId ? await this.songModel.findById(existingSongId) : null;
    if (existingSong) {
      this.logger.log(`Found existing song via OpenSearch: "${existingSong.title}" (ID: ${existingSong._id.toString()})`);
      return existingSong;
    }

    return null;
  }

  private async createOrUpdateArtist(
    artistDoc: ArtistDocument | null,
    spotifyId: string,
    name: string,
    dryRun: boolean,
  ): Promise<{ doc: ArtistDocument; action: 'created' | 'updated' | 'none' }> {
    let action: 'created' | 'updated' | 'none' = 'none';
    if (!artistDoc) {
      this.logger.log(`Artist "${name}" does not exist. Creating new artist...`);
      let genres: string[] = [];
      try {
        const artistFull = await this.spotifyApi.getArtist(spotifyId);
        if (artistFull?.body?.genres) {
          genres = artistFull.body.genres;
        }
      } catch (e) {
        this.logger.warn(`Could not fetch full artist info for ${name} to get genres: ${getErrorMessage(e)}`);
      }

      artistDoc = new this.artistModel({
        artist: name,
        primary_genres: genres,
        albums: [],
        source: [{ name: 'spotify', sourceId: spotifyId }],
      });
      if (!dryRun) await artistDoc.save();
      this.logger.log(`Successfully created new artist: "${artistDoc.artist}"`);
      action = 'created';
    } else {
      const sourceExists = (artistDoc.source ?? []).some((s) => s.name === 'spotify' && s.sourceId === spotifyId);
      if (!sourceExists) {
        if (!dryRun) {
          artistDoc.source = artistDoc.source ?? [];
          artistDoc.source.push({ name: 'spotify', sourceId: spotifyId });
          await artistDoc.save();
        }
        this.logger.log(`Added spotify source to existing artist: "${artistDoc.artist}"`);
        action = 'updated';
      } else {
        this.logger.debug(`Spotify source already exists on artist: "${artistDoc.artist}"`);
      }
    }
    return { doc: artistDoc, action };
  }

  private async createOrUpdateAlbum(
    albumDoc: AlbumDocument | null,
    trackAlbum: SpotifyApi.AlbumObjectSimplified,
    artistDoc: ArtistDocument,
    dryRun: boolean,
  ): Promise<{ doc: AlbumDocument; action: 'created' | 'updated' | 'none' }> {
    let action: 'created' | 'updated' | 'none' = 'none';
    const spotifyId = trackAlbum.id;
    if (!albumDoc) {
      this.logger.log(`Album "${trackAlbum.name}" does not exist. Creating new album...`);
      const genre = artistDoc.primary_genres || [];
      const releaseYear = trackAlbum.release_date ? trackAlbum.release_date.substring(0, 4) : undefined;

      let imageObj: { large: string; small: string; thumbnail: string } | undefined = undefined;
      if (trackAlbum.images && trackAlbum.images.length > 0) {
        imageObj = {
          large: trackAlbum.images[0]?.url,
          small: trackAlbum.images[1]?.url || trackAlbum.images[0]?.url,
          thumbnail: trackAlbum.images[2]?.url || trackAlbum.images[0]?.url,
        };
      }

      albumDoc = new this.albumModel({
        title: trackAlbum.name,
        artist: artistDoc._id,
        release_year: releaseYear,
        track_count: trackAlbum.total_tracks,
        genre: genre,
        image: imageObj,
        release_date_original: trackAlbum.release_date,
        tracks: [],
        source: [{ name: 'spotify', sourceId: spotifyId }],
      });

      if (!dryRun) {
        await albumDoc.save();
        if (!artistDoc.albums.includes(albumDoc._id)) {
          artistDoc.albums.push(albumDoc._id);
          await artistDoc.save();
        }
      }
      this.logger.log(`Successfully created new album: "${albumDoc.title}"`);
      action = 'created';
    } else {
      const sourceExists = (albumDoc.source ?? []).some((s) => s.name === 'spotify' && s.sourceId === spotifyId);
      if (!sourceExists) {
        if (!dryRun) {
          albumDoc.source = albumDoc.source ?? [];
          albumDoc.source.push({ name: 'spotify', sourceId: spotifyId });
          await albumDoc.save();
        }
        this.logger.log(`Added spotify source to existing album: "${albumDoc.title}"`);
        action = 'updated';
      } else {
        this.logger.debug(`Spotify source already exists on album: "${albumDoc.title}"`);
      }

      if (!artistDoc.albums.includes(albumDoc._id)) {
        if (!dryRun) {
          artistDoc.albums.push(albumDoc._id);
          await artistDoc.save();
        }
        this.logger.log(`Linked existing album "${albumDoc.title}" to artist "${artistDoc.artist}"`);
        action = 'updated';
      }
    }
    return { doc: albumDoc, action };
  }

  private async createOrUpdateSong(
    songDoc: SongDocument | null,
    track: SpotifyApi.TrackObjectFull,
    artistDoc: ArtistDocument,
    albumDoc: AlbumDocument,
    dryRun: boolean,
  ): Promise<{ doc: SongDocument; action: 'created' | 'updated' | 'none' }> {
    let action: 'created' | 'updated' | 'none' = 'none';
    const spotifyId = track.id;
    const spotifySource = this.buildSpotifySource(track, spotifyId);

    if (!songDoc) {
      this.logger.log(`Song "${track.name}" does not exist. Creating new song...`);
      const releaseYear = track.album.release_date ? track.album.release_date.substring(0, 4) : undefined;
      const albumArtistName = track.album.artists[0]?.name || artistDoc.artist;

      songDoc = new this.songModel({
        title: track.name,
        artist: artistDoc._id,
        album: albumDoc._id,
        album_artist: albumArtistName,
        track_number: track.track_number,
        disc_number: track.disc_number,
        year: releaseYear,
        category: 'Music',
        source: [spotifySource],
        created_by: 'spotify',
      });

      if (!dryRun) {
        await songDoc.save();
        if (!albumDoc.tracks.includes(songDoc._id as unknown as Song)) {
          albumDoc.tracks.push(songDoc._id as unknown as Song);
          await albumDoc.save();
        }

        try {
          const songForIndex = {
            _id: songDoc._id,
            track_number: songDoc.track_number || 0,
            disc_number: songDoc.disc_number || 0,
            year: songDoc.year || '',
            title: songDoc.title || '',
            artist: artistDoc,
            album: albumDoc,
          } as PopulatedSong;
          await this.opensearchService.indexSongs([songForIndex]);
          this.logger.debug(`Indexed song ${songDoc.title} in OpenSearch.`);
        } catch (error) {
          const errMessage = describeSpotifyError(error);
          this.logger.error(`Failed to index new song ${songDoc.title} in OpenSearch: ${errMessage}`);
        }
      }
      this.logger.log(`Successfully created new song: "${songDoc.title}"`);
      action = 'created';
    } else {
      const sourceExists = (songDoc.source ?? []).some((s) => s.name === 'spotify' && s.sourceId === spotifyId);
      if (!sourceExists) {
        if (!dryRun) {
          songDoc.source = songDoc.source ?? [];
          songDoc.source.push(spotifySource);
          await songDoc.save();
        }
        this.logger.log(`Added spotify source to existing song: "${songDoc.title}"`);
        action = 'updated';
      } else {
        this.logger.debug(`Spotify source already exists on song: "${songDoc.title}"`);
      }

      if (!albumDoc.tracks.includes(songDoc._id as unknown as Song)) {
        if (!dryRun) {
          albumDoc.tracks.push(songDoc._id as unknown as Song);
          await albumDoc.save();
        }
        this.logger.log(`Added existing song "${songDoc.title}" to album "${albumDoc.title}"`);
        action = 'updated';
      }
    }
    return { doc: songDoc, action };
  }

  /**
   * Builds the `SongSource` a Spotify track is attached to a song document as.
   *
   * Takes the minimum a track carries rather than the SDK's full object, so a parsed search hit
   * and an imported library track build the same source. `path` holds the bare `spotify:track:`
   * uri; the proxy host is deployment configuration and lives in `SPOTIFY_PROXY_AUDIO`.
   */
  public buildSpotifySource(track: { name: string; duration_ms?: number; external_ids?: { isrc?: string } }, trackSpotifyId: string): SongSource {
    return {
      name: 'spotify',
      sourceId: trackSpotifyId,
      path: `spotify:track:${trackSpotifyId}`,
      filename: track.name,
      isrc: track.external_ids?.isrc || undefined,
      technical_info: {
        ...SPOTIFY_TECHNICAL_DEFAULTS,
        duration: track.duration_ms ? track.duration_ms / 1000 : 0,
      } as TechnicalInfo,
    };
  }

  /**
   * The Mongo id behind the best OpenSearch hit for a name, or `null` when nothing matched. The
   * caller loads the document from its own model, which is what keeps this free of a generic.
   */
  private async findExistingEntityId(
    type: 'album' | 'artist' | 'song',
    name: string,
    options?: {
      artistName?: string;
      albumName?: string;
      artistId?: string | null;
      albumId?: string | null;
    },
  ): Promise<string | null> {
    try {
      let searchResponse: OpenSearchSearchResponse | OpenSearchArtistSearchResponse | OpenSearchAlbumSearchResponse | null;
      let idField: string;

      if (type === 'song') {
        searchResponse = await this.opensearchService.fuzzySearchSong(
          name,
          options?.albumName || '',
          options?.artistName || '',
          options?.albumId,
          options?.artistId,
        );
        idField = 'song_id';
      } else if (type === 'album') {
        searchResponse = await this.opensearchService.fuzzySearchAlbum(name);
        idField = 'album_id';
      } else {
        searchResponse = await this.opensearchService.fuzzySearchArtist(name);
        idField = 'artist_id';
      }

      if (!searchResponse) return null;
      const hits = searchResponse.hits.hits as Array<{ _score: number; _id?: string; _source?: Record<string, unknown> }>;
      if (hits.length === 0) return null;

      const bestHit = [...hits].sort((a, b) => b._score - a._score)[0];
      const sourceId = bestHit._source?.[idField];
      const entityId = type === 'song' ? bestHit._id || sourceId : sourceId;
      return typeof entityId === 'string' && entityId ? entityId : null;
    } catch (error) {
      const errMessage = describeSpotifyError(error);
      this.logger.warn(`Existing-${type} lookup failed for "${name}": ${errMessage}`);
      return null;
    }
  }
}
