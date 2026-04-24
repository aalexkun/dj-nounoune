import { Test, TestingModule } from '@nestjs/testing';
import { SpotifyService } from '../../src/services/spotify/spotify.service';
import { ConfigModule, ConfigService } from '@nestjs/config';

describe('SpotifyService (Integration)', () => {
  let service: SpotifyService;
  let configService: ConfigService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
      ],
      providers: [SpotifyService],
    }).compile();

    service = module.get<SpotifyService>(SpotifyService);
    configService = module.get<ConfigService>(ConfigService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Connection & Authentication', () => {
    it('should have credentials in .env', () => {
      expect(configService.get('SPOTIFY_CLIENT_ID')).toBeDefined();
      expect(configService.get('SPOTIFY_CLIENT_SECRET')).toBeDefined();
      expect(configService.get('SPOTIFY_REDIRECT_URL')).toBeDefined();
    });

    it('should be able to search for a song (Client Credentials check)', async () => {
      // If we only have client ID/Secret, search might work if the service handles client credentials flow
      // Currently SpotifyService only uses the tokens provided in .env.
      // If SPOTIFY_ACCESS_TOKEN is missing or expired, this will fail.
      try {
        const results = await service.searchSongs('Never Gonna Give You Up', 1);
        expect(results).toBeDefined();
        expect(results?.items.length).toBeGreaterThan(0);
      } catch (error: unknown) {
        console.warn('Search failed. This might be due to missing or expired SPOTIFY_ACCESS_TOKEN in .env');
        throw error;
      }
    });
  });

  describe('User Library (Requires User Auth)', () => {
    it('should list user library', async () => {
      try {
        const library = await service.listUserLibrary(1);
        expect(library).toBeDefined();
        expect(library.items).toBeDefined();
      } catch (error: unknown) {
        console.warn('listUserLibrary failed. Ensure SPOTIFY_ACCESS_TOKEN and SPOTIFY_REFRESH_TOKEN are valid in .env');
        throw error;
      }
    });
  });

  describe('Playlist Creation (Requires User Auth)', () => {
    it('should create a private playlist', async () => {
      const playlistName = `Integration Test Playlist ${Date.now()}`;
      try {
        const playlist = await service.createPlaylist(playlistName, 'Created by integration test', false);
        expect(playlist).toBeDefined();
        expect(playlist.name).toBe(playlistName);
      } catch (error: unknown) {
        console.warn('createPlaylist failed. Ensure tokens have correct scopes (playlist-modify-private)');
        throw error;
      }
    });
  });
});
