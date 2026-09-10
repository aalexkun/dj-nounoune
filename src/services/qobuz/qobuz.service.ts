import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PopulatedSong } from '../music-db/music-db.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  QobuzErrorResponseSchema,
  QobuzUserFavoritesResponse,
  QobuzUserFavoritesResponseSchema,
  QobuzAlbum,
  QobuzAlbumSchema,
  QobuzTrack,
  QobuzTrackSchema,
  QobuzTrackMatch,
  QobuzTrackSearchCriteria,
  QobuzTrackSearchResponse,
  QobuzTrackSearchResponseSchema,
  QobuzArtistMatch,
  QobuzArtistAlbum,
  QobuzArtistAlbumSchema,
  QobuzArtistDetailSchema,
  QobuzArtistSchema,
  QobuzArtistSearchResponse,
  QobuzArtistSearchResponseSchema,
  QobuzFavoriteInput,
  QobuzFavoriteResponseSchema,
  QobuzArtistCatalogCriteria,
  QobuzArtistCatalogResult,
} from './qobuz.interfaces';
import { z } from 'zod';
import { QobuzAuthUtil } from './qobuz-auth.util';

/** What `.qobuz-session.json` holds; anything else in the file is ignored. */
const QobuzSessionSchema = z.object({
  userId: z.string().optional(),
  userAuthToken: z.string().optional(),
});

type QobuzSession = z.infer<typeof QobuzSessionSchema>;
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { SongSource } from '../../schemas/source.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';
import { OpensearchService, DuplicateSongCheck } from '../opensearch/opensearch.service';
import {
  buildSearchQueries,
  describeParseFailure,
  getTrackArtistName,
  getTrackDisplayTitle,
  identitySimilarity,
  isPlausibleMatch,
  MATCH_FLOOR,
  scoreTrack,
  trackBelongsToArtist,
} from './qobuz-track-match.util';
import { getErrorMessage } from '../../utils/error.utils';

/** Hits scoring below this are not returned by {@link QobuzService.findTrack}. */
const MINIMUM_MATCH_SCORE = 0.6;

/** Once a hit reaches this score, trying the broader fallback queries is pointless. */
const CONFIDENT_MATCH_SCORE = 0.9;

/** Catalog hits requested per query when the caller does not say. */
const DEFAULT_SEARCH_LIMIT = 25;

/** Artist hits requested per catalog search. A handful is plenty to disambiguate a name. */
const DEFAULT_ARTIST_SEARCH_LIMIT = 10;

/** Albums pulled back with an artist page. Enough for a discography, short of a boxset dump. */
const DEFAULT_ARTIST_ALBUM_LIMIT = 30;

/** Below this an entry in the artist's own discography is not the album that was asked for. */
const ALBUM_TITLE_FLOOR = MATCH_FLOOR.album;

@Injectable()
export class QobuzService implements OnModuleInit {
  private readonly logger = new Logger(QobuzService.name);

  private readonly API_BASE_URL = 'https://www.qobuz.com/api.json/0.2';
  private appId!: string;
  private appSecret!: string;
  private userAuthToken?: string;
  public auth!: QobuzAuthUtil;

  constructor(
    private readonly configService: ConfigService,
    private readonly opensearchService: OpensearchService,
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {}

  public onModuleInit(): void {
    const appId = this.configService.get<string>('QOBUZ_APP_ID');
    const appSecret = this.configService.get<string>('QOBUZ_APP_SECRET');

    if (!appId || !appSecret) {
      this.logger.warn('QOBUZ_APP_ID or QOBUZ_APP_SECRET is missing. QobuzService will not function properly.');
    }

    this.appId = appId || '';
    this.appSecret = appSecret || '';

    this.auth = new QobuzAuthUtil(this.configService);
  }

  /**
   * Generates MD5 hash for the given input string
   */
  private md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Generates signature for protected Qobuz API endpoints.
   */
  private generateSignature(method: string, endpoint: string, params: Record<string, string>): string {
    const allParams = { ...params };
    allParams['app_id'] = this.appId;
    allParams['method'] = method;

    if (this.userAuthToken) {
      allParams['user_auth_token'] = this.userAuthToken;
    }

    // Sort parameters alphabetically by key
    const sortedKeys = Object.keys(allParams).sort();

    let signatureString = `${method}${endpoint}`;
    for (const key of sortedKeys) {
      signatureString += `${key}${allParams[key]}`;
    }
    signatureString += this.appSecret;

    return this.md5(signatureString);
  }

  /**
   * Formats a record of string parameters into a URL-encoded query string
   */
  private toQueryString(params: Record<string, string>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchParams.append(key, value);
    }
    return searchParams.toString();
  }

  /**
   * Send a GET request to the Qobuz API with signature authentication.
   */
  private async qobuzGet<T>(endpoint: string, params: Record<string, string>, schema: z.ZodSchema<T>): Promise<T> {
    if (!this.userAuthToken) {
      throw new Error('User authentication token is missing. Please authenticate first.');
    }

    const requestParams = {
      ...params,
    };

    const headers: Record<string, string> = {};
    headers['X-User-Auth-Token'] = this.userAuthToken;
    headers['X-App-Id'] = this.appId;

    const queryString = this.toQueryString(requestParams);
    const url = `${this.API_BASE_URL}${endpoint}?${queryString}`;

    const response = await fetch(url, { headers });
    const jsonData = (await response.json()) as unknown;

    const errorResult = QobuzErrorResponseSchema.safeParse(jsonData);
    if (errorResult.success && errorResult.data.status === 'error') {
      throw new Error(`Qobuz API Error: ${errorResult.data.message} (code: ${errorResult.data.code})`);
    }

    return schema.parse(jsonData);
  }

  /**
   * Send a POST request to the Qobuz API.
   *
   * The mutating endpoints (`/favorite/create`, `/favorite/delete`) take their parameters as a form
   * body rather than a query string, which is the only reason this exists beside {@link qobuzGet}.
   */
  private async qobuzPost<T>(endpoint: string, params: Record<string, string>, schema: z.ZodSchema<T>): Promise<T> {
    if (!this.userAuthToken) {
      throw new Error('User authentication token is missing. Please authenticate first.');
    }

    const headers: Record<string, string> = {
      'X-User-Auth-Token': this.userAuthToken,
      'X-App-Id': this.appId,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    const response = await fetch(`${this.API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: this.toQueryString(params),
    });

    const jsonData = (await response.json()) as unknown;

    const errorResult = QobuzErrorResponseSchema.safeParse(jsonData);
    if (errorResult.success && errorResult.data.status === 'error') {
      throw new Error(`Qobuz API Error: ${errorResult.data.message} (code: ${errorResult.data.code})`);
    }

    return schema.parse(jsonData);
  }

  private getSessionFilePath(): string {
    return path.join(process.cwd(), '.qobuz-session.json');
  }

  private loadSession(): QobuzSession {
    try {
      const sessionPath = this.getSessionFilePath();
      if (fs.existsSync(sessionPath)) {
        const data = fs.readFileSync(sessionPath, 'utf8');
        return QobuzSessionSchema.parse(JSON.parse(data));
      }
    } catch (error) {
      this.logger.error(`Error loading Qobuz session: ${getErrorMessage(error)}`);
    }
    return {};
  }

  /**
   * Authenticate with the Qobuz API using the username and md5 password
   */
  public login(): Promise<string> {
    if (this.userAuthToken) {
      return Promise.resolve(this.userAuthToken);
    }

    const session = this.loadSession();
    this.userAuthToken = session.userAuthToken;
    if (!this.userAuthToken) {
      return Promise.reject(
        new Error('Qobuz session data (.qobuz-session.json) is missing. Please authenticate first by running the auth CLI command.'),
      );
    }
    return Promise.resolve(this.userAuthToken);
  }

  /**
   * Retrieve the list of all favorite songs
   */
  public async getFavorites(limit: number = 50, offset: number = 0): Promise<QobuzUserFavoritesResponse> {
    await this.login();

    const params = {
      type: 'tracks',
      limit: limit.toString(),
      offset: offset.toString(),
    };

    return this.qobuzGet<QobuzUserFavoritesResponse>('/favorite/getUserFavorites', params, QobuzUserFavoritesResponseSchema);
  }

  /**
   * Retrieve the list of all favorite albums
   */
  public async getFavoriteAlbums(limit: number = 50, offset: number = 0): Promise<QobuzUserFavoritesResponse> {
    await this.login();

    const params = {
      type: 'albums',
      limit: limit.toString(),
      offset: offset.toString(),
    };

    return this.qobuzGet<QobuzUserFavoritesResponse>('/favorite/getUserFavorites', params, QobuzUserFavoritesResponseSchema);
  }

  /**
   * Retrieve full details of an album, including its tracks
   */
  public async getAlbum(albumId: string): Promise<QobuzAlbum> {
    await this.login();

    const params = {
      album_id: albumId,
    };

    return this.qobuzGet<QobuzAlbum>('/album/get', params, QobuzAlbumSchema);
  }

  /**
   * Retrieve one track by its Qobuz id.
   */
  public async getTrack(trackId: string): Promise<QobuzTrack> {
    await this.login();

    return this.qobuzGet<QobuzTrack>('/track/get', { track_id: trackId }, QobuzTrackSchema);
  }

  /**
   * Searches the Qobuz catalog for an artist by name, best match first.
   *
   * Unlike {@link searchTracks} there is nothing to score here — Qobuz already ranks artist hits by
   * relevance, and a name is either right or it is not. An empty array means the catalog holds no
   * such artist, which callers must treat as final rather than retrying with another spelling.
   */
  public async searchArtists(query: string, limit: number = DEFAULT_ARTIST_SEARCH_LIMIT): Promise<QobuzArtistMatch[]> {
    if (!query || !query.trim()) {
      throw new Error('An artist name is required to search the Qobuz catalog.');
    }

    await this.login();

    const response = await this.qobuzGet<QobuzArtistSearchResponse>(
      '/catalog/search',
      {
        query: query.trim(),
        type: 'artists',
        limit: limit.toString(),
        offset: '0',
      },
      QobuzArtistSearchResponseSchema,
    );

    const items = response.artists?.items ?? [];
    const matches: QobuzArtistMatch[] = [];

    for (const item of items) {
      const parsed = QobuzArtistSchema.safeParse(item);

      if (!parsed.success) {
        this.logger.warn(`Discarding a Qobuz artist hit the schema no longer accepts: ${JSON.stringify(item)}`);
        continue;
      }

      const image = parsed.data.image;

      matches.push({
        id: parsed.data.id.toString(),
        name: parsed.data.name,
        albumsCount: parsed.data.albums_count,
        picture: parsed.data.picture ?? (typeof image === 'string' ? image : (image?.large ?? image?.medium ?? image?.small)),
      });
    }

    return matches;
  }

  /**
   * The discography of an artist, as the artist page reports it.
   *
   * Best-effort by design: this only ever decorates an artist that has already been found, so a
   * schema drift on the artist page returns an empty discography rather than sinking the lookup.
   */
  public async getArtistAlbums(artistId: string, limit: number = DEFAULT_ARTIST_ALBUM_LIMIT): Promise<QobuzArtistAlbum[]> {
    await this.login();

    try {
      const detail = await this.qobuzGet(
        '/artist/get',
        {
          artist_id: artistId,
          extra: 'albums',
          limit: limit.toString(),
          offset: '0',
        },
        QobuzArtistDetailSchema,
      );

      const albums: QobuzArtistAlbum[] = [];

      for (const item of detail.albums?.items ?? []) {
        const parsed = QobuzArtistAlbumSchema.safeParse(item);

        if (parsed.success) {
          albums.push(parsed.data);
        }
      }

      return albums;
    } catch (error) {
      this.logger.warn(`Could not read the discography of Qobuz artist ${artistId}: ${getErrorMessage(error)}`);
      return [];
    }
  }

  /**
   * Adds tracks, albums or artists to the account's Qobuz favourites.
   *
   * Qobuz takes all three lists in one call, and answers with nothing but a status, so there is
   * no per-id outcome to report: either the call succeeded or it threw.
   */
  public async addFavorites(input: QobuzFavoriteInput): Promise<void> {
    const params: Record<string, string> = {};

    if (input.trackIds?.length) params['track_ids'] = input.trackIds.join(',');
    if (input.albumIds?.length) params['album_ids'] = input.albumIds.join(',');
    if (input.artistIds?.length) params['artist_ids'] = input.artistIds.join(',');

    if (Object.keys(params).length === 0) {
      throw new Error('Nothing to favourite: give at least one track, album or artist id.');
    }

    await this.login();

    await this.qobuzPost('/favorite/create', params, QobuzFavoriteResponseSchema);
  }

  /**
   * Raw catalog search restricted to the `tracks` bucket.
   */
  private async searchCatalogTracks(query: string, limit: number, offset: number = 0): Promise<QobuzTrackSearchResponse> {
    const params = {
      query,
      type: 'tracks',
      limit: limit.toString(),
      offset: offset.toString(),
    };

    return this.qobuzGet<QobuzTrackSearchResponse>('/catalog/search', params, QobuzTrackSearchResponseSchema);
  }

  /**
   * Searches the Qobuz catalog for a track, ranked best-match first.
   *
   * The catalog endpoint takes one free-text query with no per-field operators,
   * so artist and album are used twice: to narrow the query text, and to score
   * the hits it returns. Queries are tried from most to least specific
   * (`buildSearchQueries`) and the loop stops early once a hit is confident
   * enough, which keeps the common case to a single API call while still
   * recovering when one of the criteria is slightly off.
   *
   * @param criteria - Title (mandatory) plus optional artist/album
   * @returns Every distinct track seen across the attempted queries, sorted by descending score
   */
  public async searchTracks(criteria: QobuzTrackSearchCriteria): Promise<QobuzTrackMatch[]> {
    if (!criteria.title || !criteria.title.trim()) {
      throw new Error('A track title is required to search the Qobuz catalog.');
    }

    await this.login();

    const limit = criteria.limit ?? DEFAULT_SEARCH_LIMIT;
    const matches = new Map<string, QobuzTrackMatch>();

    for (const query of buildSearchQueries(criteria)) {
      this.logger.debug(`Qobuz catalog search: "${query}"`);

      let response: QobuzTrackSearchResponse;
      try {
        response = await this.searchCatalogTracks(query, limit);
      } catch (error) {
        // A single over-specified query failing must not sink the fallbacks.
        this.logger.warn(`Qobuz catalog search failed for "${query}": ${getErrorMessage(error)}`);
        continue;
      }

      const items = response.tracks?.items ?? [];
      this.logger.debug(`  ${items.length} hit(s) returned`);

      for (const item of items) {
        const parsed = QobuzTrackSchema.safeParse(item);

        if (!parsed.success) {
          // Not a "nothing found" — this is a real result being thrown away, so
          // it is worth a warning rather than a debug line. Every optional field
          // already tolerates null (`qobuzOptional`), so reaching here means the
          // payload has changed shape and matches are being lost silently.
          this.logger.warn(`Discarding a Qobuz hit the schema no longer accepts: ${describeParseFailure(item, parsed.error)}`);
          continue;
        }

        const match = this.toTrackMatch(parsed.data, criteria, query);
        const previous = matches.get(match.id);

        // The same track can surface under several queries; keep its best score.
        if (!previous || match.score.total > previous.score.total) {
          matches.set(match.id, match);
        }
      }

      // Only a hit that actually satisfies the criteria may end the search. Judging this on the
      // raw pool let a strong title with the wrong artist stop the loop before the query that
      // would have found the real recording ever ran.
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

  /**
   * The hits that satisfy every criterion the caller stated, and that can actually be streamed.
   *
   * Ranking the rest lower is not enough. The fallback query chain ends with the bare title, so
   * once a specific query comes up short the pool fills with other artists' recordings of the same
   * song — and the caller is usually an agent that reads the top rows as the answer.
   */
  private keepPlausible(matches: QobuzTrackMatch[], criteria: QobuzTrackSearchCriteria): QobuzTrackMatch[] {
    return matches.filter((match) => match.streamable && isPlausibleMatch(match.score, criteria));
  }

  /**
   * Looks a recording up **locked to one artist**: the name is resolved to a Qobuz artist id
   * first, and nothing that is not that artist's can come back.
   *
   * {@link searchTracks} cannot offer this. `/catalog/search` takes a single free-text query with no
   * per-field operators, so an artist name inside it is a hint the ranker may ignore — and when the
   * specific query comes up empty the fallback chain broadens to the title alone. Ask it for
   * "Bad Behaviour" by Spice and it answers with The Beaches, Elli Ingram and Mabel.
   *
   * Two routes, both anchored on the artist id:
   * - **With an album**, the album is resolved against the artist's own discography and its
   *   tracklist is read straight off `/album/get`. No fuzzy track matching happens at all, which is
   *   the right answer whenever the user named both an artist and a record.
   * - **Without one**, the catalog search still runs, but every hit is then verified against the
   *   artist id rather than against the spelling of a name.
   */
  public async searchArtistCatalog(criteria: QobuzArtistCatalogCriteria): Promise<QobuzArtistCatalogResult> {
    if (!criteria.artist || !criteria.artist.trim()) {
      throw new Error('An artist name is required to search the Qobuz catalog by artist.');
    }

    const artistName = criteria.artist.trim();
    const candidates = await this.searchArtists(artistName, DEFAULT_ARTIST_SEARCH_LIMIT);

    if (candidates.length === 0) {
      this.logger.debug(`No Qobuz artist named "${artistName}"`);
      return { artist: null, candidates: [], albums: [], tracks: [], source: 'none' };
    }

    const artist = this.pickArtist(candidates, artistName);
    const albums = await this.getArtistAlbums(artist.id, DEFAULT_ARTIST_ALBUM_LIMIT);

    this.logger.debug(`Locked on Qobuz artist ${artist.name} (${artist.id}), ${albums.length} album(s)`);

    if (criteria.album?.trim()) {
      return this.tracksFromArtistAlbum(artist, candidates, albums, criteria);
    }

    if (criteria.title?.trim()) {
      return this.tracksFromLockedCatalogSearch(artist, candidates, albums, criteria);
    }

    return { artist, candidates, albums, tracks: [], source: 'none' };
  }

  /**
   * The best of the artist hits Qobuz returned.
   *
   * Qobuz ranks by its own relevance, which puts a busier artist above an exact namesake often
   * enough to matter. An exact name wins; short of that, Qobuz's own order stands.
   */
  private pickArtist(candidates: QobuzArtistMatch[], artistName: string): QobuzArtistMatch {
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
    artist: QobuzArtistMatch,
    candidates: QobuzArtistMatch[],
    albums: QobuzArtistAlbum[],
    criteria: QobuzArtistCatalogCriteria,
  ): Promise<QobuzArtistCatalogResult> {
    const wanted = criteria.album!.trim();
    let matchedAlbum: QobuzArtistAlbum | undefined;
    let albumScore = 0;

    for (const album of albums) {
      const qualified = album.version ? `${album.title} (${album.version})` : album.title;
      const score = Math.max(identitySimilarity(wanted, album.title), identitySimilarity(wanted, qualified));

      if (score > albumScore) {
        matchedAlbum = album;
        albumScore = score;
      }
    }

    if (!matchedAlbum || albumScore < ALBUM_TITLE_FLOOR) {
      this.logger.debug(`No album like "${wanted}" in the discography of ${artist.name}`);
      return { artist, candidates, albums, tracks: [], source: 'none' };
    }

    this.logger.debug(`Album "${wanted}" resolved to "${matchedAlbum.title}" (${matchedAlbum.id}, ${albumScore.toFixed(2)})`);

    let detail: QobuzAlbum;

    try {
      detail = await this.getAlbum(matchedAlbum.id);
    } catch (error) {
      this.logger.warn(`Could not read Qobuz album ${matchedAlbum.id}: ${getErrorMessage(error)}`);
      return { artist, candidates, albums, matchedAlbum, albumScore, tracks: [], source: 'none' };
    }

    // A tracklist item carries no album block of its own, so give it the one it came from — the
    // reported metadata and the scoring both read it from there.
    const items = (detail.tracks?.items ?? []).map((track) => ({ ...track, album: track.album ?? detail }));

    // Scoring a tracklist against the album it *is* would be circular, so the criteria used here
    // are the ones that were genuinely in question: the title, when one was asked for.
    const scored = items.map((track) =>
      this.toTrackMatch(track, { title: criteria.title?.trim() || getTrackDisplayTitle(track), artist: artist.name }, `album:${matchedAlbum.id}`),
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

  /** The title-only route: the ordinary catalog search, with every hit verified against the id. */
  private async tracksFromLockedCatalogSearch(
    artist: QobuzArtistMatch,
    candidates: QobuzArtistMatch[],
    albums: QobuzArtistAlbum[],
    criteria: QobuzArtistCatalogCriteria,
  ): Promise<QobuzArtistCatalogResult> {
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
   * Convenience wrapper over {@link searchTracks} returning the single best
   * candidate, or `null` when nothing scored above `minimumScore`.
   */
  public async findTrack(criteria: QobuzTrackSearchCriteria, minimumScore: number = MINIMUM_MATCH_SCORE): Promise<QobuzTrackMatch | null> {
    const [best] = await this.searchTracks(criteria);

    if (!best || best.score.total < minimumScore) {
      return null;
    }

    return best;
  }

  private toTrackMatch(track: QobuzTrack, criteria: QobuzTrackSearchCriteria, matchedQuery: string): QobuzTrackMatch {
    return {
      id: track.id.toString(),
      title: track.title,
      version: track.version ?? undefined,
      artist: getTrackArtistName(track),
      album: track.album?.title ?? '',
      albumId: track.album?.id,
      duration: track.duration,
      hires: track.hires ?? false,
      streamable: track.streamable ?? false,
      score: scoreTrack(track, criteria),
      matchedQuery,
      track,
    };
  }

  public async importFavoriteAlbums(ImportLastXAlbum: number = Number.MAX_SAFE_INTEGER): Promise<void> {
    this.logger.log('Retrieving Qobuz favorite albums for import...');
    try {
      const limit = 50;
      let offset = 0;
      let total = 0;
      let importedAlbumsCount = 0;

      do {
        const response = await this.getFavoriteAlbums(limit, offset);

        if (!response || !response.albums) {
          throw new Error('Invalid response from Qobuz API: Missing albums property');
        }

        for (const albumItem of response.albums.items) {
          try {
            const albumQobuzId = albumItem.id.toString();
            const existingAlbum = await this.albumModel.exists({
              'source.name': 'qobuz',
              'source.sourceId': albumQobuzId,
            });

            if (existingAlbum) {
              this.logger.debug(`Album already imported: ${albumItem.title} (${albumQobuzId})`);
              continue;
            }

            this.logger.debug(`Fetching details for album: ${albumItem.title} (${albumItem.id})`);

            const albumDetails = await this.getAlbum(albumQobuzId);
            await this.importAlbum(albumDetails);
            importedAlbumsCount++;
          } catch (albumError) {
            const errMessage = albumError instanceof Error ? albumError.message : String(albumError);
            this.logger.error(`Failed to import album ${albumItem.id}: ${errMessage}`);
          }
        }

        total = response.albums.total;
        offset += limit;
      } while (offset < total && importedAlbumsCount < ImportLastXAlbum);

      this.logger.log(`Successfully imported ${importedAlbumsCount} favorite albums with their tracks.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to retrieve/import favorite albums: ${errorMessage}`);
    }
  }

  private async importAlbum(albumDetails: QobuzAlbum): Promise<void> {
    // 1. Find or create Artist
    const artistQobuzId = albumDetails.artist.id.toString();
    let artistDoc = await this.artistModel.findOne({
      'source.name': 'qobuz',
      'source.sourceId': artistQobuzId,
    });

    // 1b. No exact qobuz source: lookup an existing artist (e.g. imported from
    // another source) before creating a duplicate. If found, add qobuz as an
    // additional source.
    if (!artistDoc) {
      const existingArtist = await this.findExistingArtist(albumDetails.artist.name);

      if (existingArtist) {
        artistDoc = existingArtist;
        const sourceExists = (artistDoc.source ?? []).some((s) => s.name === 'qobuz' && s.sourceId === artistQobuzId);

        if (!sourceExists) {
          artistDoc.source = artistDoc.source ?? [];
          artistDoc.source.push({ name: 'qobuz', sourceId: artistQobuzId });
          await artistDoc.save();
          this.logger.debug(`Added qobuz source to existing artist: ${artistDoc.artist}`);
        }
      }
    }

    if (!artistDoc) {
      const genres = albumDetails.genre ? [albumDetails.genre.name] : [];
      artistDoc = new this.artistModel({
        artist: albumDetails.artist.name,
        primary_genres: genres,
        albums: [],
        source: [{ name: 'qobuz', sourceId: artistQobuzId }],
      });
      await artistDoc.save();
      this.logger.debug(`Created new artist: ${artistDoc.artist}`);
    }

    // 2. Find or create Album
    const albumQobuzId = albumDetails.id.toString();
    let albumDoc = await this.albumModel.findOne({
      'source.name': 'qobuz',
      'source.sourceId': albumQobuzId,
    });

    // 2b. No exact qobuz source: lookup an existing album (e.g. imported from
    // another source) before creating a duplicate. If found, add qobuz as an
    // additional source.
    if (!albumDoc) {
      const existingAlbum = await this.findExistingAlbum(albumDetails.title);

      if (existingAlbum) {
        albumDoc = existingAlbum;
        const sourceExists = (albumDoc.source ?? []).some((s) => s.name === 'qobuz' && s.sourceId === albumQobuzId);

        if (!sourceExists) {
          albumDoc.source = albumDoc.source ?? [];
          albumDoc.source.push({ name: 'qobuz', sourceId: albumQobuzId });
          await albumDoc.save();
          this.logger.debug(`Added qobuz source to existing album: ${albumDoc.title}`);
        }

        // Ensure the album is linked to the artist.
        if (!artistDoc.albums.includes(albumDoc._id)) {
          artistDoc.albums.push(albumDoc._id);
          await artistDoc.save();
        }
      }
    }

    if (!albumDoc) {
      const releaseYear = albumDetails.release_date_original ? albumDetails.release_date_original.substring(0, 4) : undefined;
      const genre = albumDetails.genre ? [albumDetails.genre.name] : [];

      albumDoc = new this.albumModel({
        title: albumDetails.title,
        artist: artistDoc._id,
        release_year: releaseYear,
        track_count: albumDetails.tracks_count,
        genre: genre,
        image: albumDetails.image,
        release_date_original: albumDetails.release_date_original,
        subtitle: albumDetails.subtitle,
        description: albumDetails.description,
        tracks: [],
        source: [{ name: 'qobuz', sourceId: albumQobuzId }],
      });
      await albumDoc.save();
      this.logger.debug(`Created new album: ${albumDoc.title}`);

      // Update artist albums list
      if (!artistDoc.albums.includes(albumDoc._id)) {
        artistDoc.albums.push(albumDoc._id);
        await artistDoc.save();
      }
    }

    // 3. Process Tracks
    if (albumDetails.tracks && albumDetails.tracks.items) {
      for (const track of albumDetails.tracks.items) {
        const trackQobuzId = track.id.toString();
        const trackYear = track.release_date_original ? track.release_date_original.substring(0, 4) : undefined;
        const qobuzSource = this.buildQobuzSource(track, trackQobuzId);

        // 3a. Exact match on an existing qobuz source
        let songDoc = await this.songModel.findOne({
          'source.name': 'qobuz',
          'source.sourceId': trackQobuzId,
        });

        if (songDoc) {
          continue;
        }

        // 3b. Lookup for an existing song (e.g. imported from another source)
        // before creating a new one. If found, add qobuz as an additional source.
        const existingSong = await this.findExistingSong({
          title: track.title,
          artist: albumDetails.artist.name,
          album: albumDetails.title,
          track_number: track.track_number ?? 0,
          disc_number: track.media_number ?? 0,
          year: trackYear ?? '',
        });

        if (existingSong) {
          const sourceExists = (existingSong.source ?? []).some((s) => s.name === 'qobuz' && s.sourceId === trackQobuzId);

          if (!sourceExists) {
            existingSong.source = existingSong.source ?? [];
            existingSong.source.push(qobuzSource);
            await existingSong.save();
            this.logger.debug(`Added qobuz source to existing song: ${existingSong.title}`);
          }

          if (!albumDoc.tracks.includes(existingSong._id as unknown as Song)) {
            albumDoc.tracks.push(existingSong._id as unknown as Song);
            await albumDoc.save();
          }

          continue;
        }

        // 3c. No existing song found, create a new one.
        songDoc = new this.songModel({
          title: track.title,
          artist: artistDoc._id,
          album: albumDoc._id,
          album_artist: albumDetails.artist.name,
          track_number: track.track_number,
          disc_number: track.media_number,
          year: trackYear,
          category: albumDetails.genre?.name || 'Music',
          source: [qobuzSource],
          created_by: 'qobuz',
        });

        await songDoc.save();
        this.logger.debug(`Created new song: ${songDoc.title}`);

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
          } as unknown as PopulatedSong; // a deliberate partial: the index only reads ids, titles and the artist/album names
          await this.opensearchService.indexSongs([songForIndex]);
          this.logger.debug(`Indexed song ${songDoc.title} in OpenSearch.`);
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to index new song ${songDoc.title} in OpenSearch: ${errMessage}`);
        }
      }
    }
  }

  /** Builds the `SongSource` a qobuz track is attached to a song document as. */
  public buildQobuzSource(track: QobuzTrack, trackQobuzId: string): SongSource {
    return {
      name: 'qobuz',
      sourceId: trackQobuzId,
      path: `/qobuz/track/version/1/trackId/${trackQobuzId}`,
      filename: track.title,
      // The one identity key that survives every spelling: dedup treats a shared ISRC as proof.
      isrc: track.isrc ?? undefined,
      technical_info: {
        bitrate: 0,
        sample_rate: track.maximum_sampling_rate * 1000,
        bit_depth: track.maximum_bit_depth,
        is_high_res: track.hires,
        is_cd_quality: true,
        extension: 'flac',
        duration: track.duration,
      } as TechnicalInfo,
    };
  }

  private async findExistingAlbum(albumName: string) {
    try {
      const searchResponse = await this.opensearchService.fuzzySearchAlbum(albumName);

      if (!searchResponse) {
        return null;
      }

      const hits = searchResponse.hits.hits as Array<{
        _score: number;
        _source?: { album_id?: string };
      }>;

      if (!hits || hits.length === 0) {
        return null;
      }

      // Multiple hits: use the one with the highest score.
      const bestHit = [...hits].sort((a, b) => b._score - a._score)[0];
      const albumId = bestHit?._source?.album_id;

      if (!albumId) {
        return null;
      }

      return this.albumModel.findById(albumId);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Existing-album lookup failed for "${albumName}": ${errMessage}`);
      return null;
    }
  }

  private async findExistingArtist(artistName: string) {
    try {
      const searchResponse = await this.opensearchService.fuzzySearchArtist(artistName);

      if (!searchResponse) {
        return null;
      }

      const hits = searchResponse.hits.hits as Array<{
        _score: number;
        _source?: { artist_id?: string };
      }>;

      if (!hits || hits.length === 0) {
        return null;
      }

      // Multiple hits: use the one with the highest score.
      const bestHit = [...hits].sort((a, b) => b._score - a._score)[0];
      const artistId = bestHit?._source?.artist_id;

      if (!artistId) {
        return null;
      }

      return this.artistModel.findById(artistId);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Existing-artist lookup failed for "${artistName}": ${errMessage}`);
      return null;
    }
  }

  private async findExistingSong(attributes: Omit<DuplicateSongCheck, 'songId'>): Promise<SongDocument | null> {
    try {
      const searchResponse = await this.opensearchService.findDuplicatesSongs({
        songId: '',
        ...attributes,
      });

      if (!searchResponse) {
        return null;
      }

      // Only treat high-confidence matches as the same song.
      const bestHit = searchResponse.hits.hits.filter((hit) => hit._score >= 100).sort((a, b) => b._score - a._score)[0];

      if (!bestHit) {
        return null;
      }

      return this.songModel.findById(bestHit._id);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Existing-song lookup failed for "${attributes.title}": ${errMessage}`);
      return null;
    }
  }
}
