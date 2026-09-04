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
import { PopulatedSong } from '../music-db/music-db.service';
import { getErrorMessage } from '../../utils/error.utils';
import { OpenSearchAlbumSearchResponse, OpenSearchArtistSearchResponse, OpenSearchSearchResponse } from '../opensearch/types';

/** What `.spotify-session.json` holds; anything else in the file is ignored. */
const SpotifySessionSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expirationTime: z.number().optional(),
});
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
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error creating playlist: ${errorMessage}`);
      throw error;
    }
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
            const errMessage = trackError instanceof Error ? trackError.message : String(trackError);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
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
          const errMessage = error instanceof Error ? error.message : String(error);
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

  private buildSpotifySource(track: SpotifyApi.TrackObjectFull, trackSpotifyId: string): SongSource {
    return {
      name: 'spotify',
      sourceId: trackSpotifyId,
      path: `spotify:track:${trackSpotifyId}`,
      filename: track.name,
      technical_info: {
        bitrate: 320000,
        sample_rate: 44100,
        bit_depth: 16,
        is_high_res: false,
        is_cd_quality: false,
        extension: 'ogg',
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
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Existing-${type} lookup failed for "${name}": ${errMessage}`);
      return null;
    }
  }
}
