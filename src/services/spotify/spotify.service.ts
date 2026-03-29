import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SpotifyWebApi from 'spotify-web-api-node';

@Injectable()
export class SpotifyService implements OnModuleInit {
  private readonly logger = new Logger(SpotifyService.name);
  private spotifyApi: SpotifyWebApi;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
    const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');
    const accessToken = this.configService.get<string>('SPOTIFY_ACCESS_TOKEN');
    const refreshToken = this.configService.get<string>('SPOTIFY_REFRESH_TOKEN');

    this.spotifyApi = new SpotifyWebApi({
      clientId,
      clientSecret,
    });

    if (accessToken) {
      this.spotifyApi.setAccessToken(accessToken);
    }
    if (refreshToken) {
      this.spotifyApi.setRefreshToken(refreshToken);
    }
  }

  public getClient(): SpotifyWebApi {
    return this.spotifyApi;
  }

  async searchSongs(query: string, limit: number = 20) {
    try {
      const result = await this.spotifyApi.searchTracks(query, { limit });
      return result.body.tracks;
    } catch (error: any) {
      this.logger.error(`Error searching songs: ${error.message}`);
      throw error;
    }
  }

  async listUserLibrary(limit: number = 20, offset: number = 0) {
    try {
      // getMySavedTracks requires user authentication
      const result = await this.spotifyApi.getMySavedTracks({ limit, offset });
      return result.body;
    } catch (error: any) {
      this.logger.error(`Error listing user library: ${error.message}`);
      throw error;
    }
  }

  async createPlaylist(name: string, description?: string, isPublic: boolean = false) {
    try {
      const result = await this.spotifyApi.createPlaylist(name, {
        description,
        public: isPublic,
      });
      return result.body;
    } catch (error: any) {
      this.logger.error(`Error creating playlist: ${error.message}`);
      throw error;
    }
  }
}
