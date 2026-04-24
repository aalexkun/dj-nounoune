import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SpotifyWebApi from 'spotify-web-api-node';
import { SpotifyAuthUtil } from './spotify-auth.util';

@Injectable()
export class SpotifyService implements OnModuleInit {
  private readonly logger = new Logger(SpotifyService.name);
  private spotifyApi!: SpotifyWebApi;
  public auth!: SpotifyAuthUtil;

  constructor(private readonly configService: ConfigService) {}

  public onModuleInit(): void {
    const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('SPOTIFY_REDIRECT_URL');
    const accessToken = this.configService.get<string>('SPOTIFY_ACCESS_TOKEN');
    const refreshToken = this.configService.get<string>('SPOTIFY_REFRESH_TOKEN');

    this.spotifyApi = new SpotifyWebApi({
      clientId,
      clientSecret,
      redirectUri,
    });

    if (accessToken) {
      this.spotifyApi.setAccessToken(accessToken);
    }
    if (refreshToken) {
      this.spotifyApi.setRefreshToken(refreshToken);
    }

    this.auth = new SpotifyAuthUtil(this.spotifyApi, this.configService);
  }

  public getClient(): SpotifyWebApi {
    return this.spotifyApi;
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
}
