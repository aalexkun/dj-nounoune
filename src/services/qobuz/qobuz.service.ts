import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
} from './qobuz.interfaces';
import { z } from 'zod';
import { QobuzAuthUtil } from './qobuz-auth.util';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { SongSource } from '../../schemas/source.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';
import { OpensearchService, DuplicateSongCheck } from '../opensearch/opensearch.service';

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

    if (!this.userAuthToken){
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
    const jsonData = await response.json() as unknown;

    const errorResult = QobuzErrorResponseSchema.safeParse(jsonData);
    if (errorResult.success && errorResult.data.status === 'error') {
      throw new Error(`Qobuz API Error: ${errorResult.data.message} (code: ${errorResult.data.code})`);
    }

    return schema.parse(jsonData);
  }

  private getSessionFilePath(): string {
    return path.join(process.cwd(), '.qobuz-session.json');
  }

  private loadSession(): { userId?: string, userAuthToken?: string } {
    try {
      const sessionPath = this.getSessionFilePath();
      if (fs.existsSync(sessionPath)) {
        const data = fs.readFileSync(sessionPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.error(`Error loading Qobuz session: ${error}`);
    }
    return {};
  }

  /**
   * Authenticate with the Qobuz API using the username and md5 password
   */
  public async login(): Promise<string> {
    if (this.userAuthToken) {
      return this.userAuthToken;
    }

    const session = this.loadSession();
    this.userAuthToken   = session.userAuthToken;
    if (!this.userAuthToken) {
      throw new Error('Qobuz session data (.qobuz-session.json) is missing. Please authenticate first by running the auth CLI command.');
    }
    return this.userAuthToken;
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
    const params = {
      album_id: albumId,
    };

    return this.qobuzGet<QobuzAlbum>('/album/get', params, QobuzAlbumSchema);
  }

  public async importFavoriteAlbums(): Promise<void> {
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
            this.logger.debug(`Fetching details for album: ${albumItem.title} (${albumItem.id})`);
            const albumDetails = await this.getAlbum(albumItem.id.toString());
            await this.importAlbum(albumDetails);
            importedAlbumsCount++;
          } catch (albumError) {
            const errMessage = albumError instanceof Error ? albumError.message : String(albumError);
            this.logger.error(`Failed to import album ${albumItem.id}: ${errMessage}`);
          }
        }

        total = response.albums.total;
        offset += limit;

      } while (offset < total);

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
        const sourceExists = (artistDoc.source ?? []).some(
          (s) => s.name === 'qobuz' && s.sourceId === artistQobuzId,
        );

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
        const sourceExists = (albumDoc.source ?? []).some(
          (s) => s.name === 'qobuz' && s.sourceId === albumQobuzId,
        );

        if (!sourceExists) {
          albumDoc.source = albumDoc.source ?? [];
          albumDoc.source.push({ name: 'qobuz', sourceId: albumQobuzId });
          await albumDoc.save();
          this.logger.debug(`Added qobuz source to existing album: ${albumDoc.title}`);
        }

        // Ensure the album is linked to the artist.
        if (!artistDoc.albums.includes(albumDoc._id as Types.ObjectId)) {
          artistDoc.albums.push(albumDoc._id as Types.ObjectId);
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
      if (!artistDoc.albums.includes(albumDoc._id as Types.ObjectId)) {
        artistDoc.albums.push(albumDoc._id as Types.ObjectId);
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
          const sourceExists = (existingSong.source ?? []).some(
            (s) => s.name === 'qobuz' && s.sourceId === trackQobuzId,
          );

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
      }
    }
  }

  private buildQobuzSource(track: QobuzTrack, trackQobuzId: string): SongSource {
    return {
      name: 'qobuz',
      sourceId: trackQobuzId,
      path: `/qobuz/track/version/1/trackId/${trackQobuzId}`,
      filename: track.title,
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

  private async findExistingSong(
    attributes: Omit<DuplicateSongCheck, 'songId'>,
  ): Promise<SongDocument | null> {
    try {
      const searchResponse = await this.opensearchService.findDuplicatesSongs({
        songId: '',
        ...attributes,
      });

      if (!searchResponse) {
        return null;
      }

      // Only treat high-confidence matches as the same song.
      const bestHit = searchResponse.hits.hits
        .filter((hit) => hit._score >= 100)
        .sort((a, b) => b._score - a._score)[0];

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
