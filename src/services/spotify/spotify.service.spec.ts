import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { SpotifyService } from './spotify.service';
import { ConfigService } from '@nestjs/config';
import SpotifyWebApi from 'spotify-web-api-node';
import { Artist } from '../../schemas/artist.schema';
import { Album } from '../../schemas/albums.schema';
import { Song } from '../../schemas/song.schema';
import { OpensearchService } from '../opensearch/opensearch.service';
import { CredentialStoreService } from '../credential-store/credential-store.service';

jest.mock('spotify-web-api-node');

describe('SpotifyService', () => {
  let service: SpotifyService;
  let mockSpotifyApi: jest.Mocked<SpotifyWebApi>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpotifyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                SPOTIFY_CLIENT_ID: 'test-client-id',
                SPOTIFY_CLIENT_SECRET: 'test-client-secret',
                SPOTIFY_REDIRECT_URL: 'http://localhost/callback',
              };
              return config[key];
            }),
          },
        },
        // The session now comes out of the credential store rather than a dotfile, so this is where
        // the tokens the assertions below expect are injected.
        {
          provide: CredentialStoreService,
          useValue: {
            isEnabled: jest.fn(() => true),
            load: jest.fn(() => Promise.resolve({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' })),
            save: jest.fn(() => Promise.resolve()),
            clear: jest.fn(() => Promise.resolve()),
          },
        },
        { provide: OpensearchService, useValue: {} },
        { provide: getModelToken(Artist.name), useValue: {} },
        { provide: getModelToken(Album.name), useValue: {} },
        { provide: getModelToken(Song.name), useValue: {} },
      ],
    }).compile();

    service = module.get<SpotifyService>(SpotifyService);

    // Get the instance created in onModuleInit
    await service.onModuleInit();
    mockSpotifyApi = service['spotifyApi'] as jest.Mocked<SpotifyWebApi>;
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.auth).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize SpotifyWebApi with config values', () => {
      expect(SpotifyWebApi).toHaveBeenCalledWith({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost/callback',
      });
      expect(mockSpotifyApi.setAccessToken).toHaveBeenCalledWith('test-access-token');
      expect(mockSpotifyApi.setRefreshToken).toHaveBeenCalledWith('test-refresh-token');
    });
  });

  describe('searchSongs', () => {
    it('should return tracks on success', async () => {
      const mockTracks = { items: [{ name: 'Song 1' }] };
      mockSpotifyApi.searchTracks.mockResolvedValue({
        body: { tracks: mockTracks } as unknown as SpotifyApi.SearchResponse,
        headers: {},
        statusCode: 200,
      });

      const result = await service.searchSongs('query', 10);

      expect(mockSpotifyApi.searchTracks).toHaveBeenCalledWith('query', { limit: 10 });
      expect(result).toEqual(mockTracks);
    });

    it('should throw error and log it on failure', async () => {
      const error = new Error('Spotify error');
      mockSpotifyApi.searchTracks.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await expect(service.searchSongs('query')).rejects.toThrow('Spotify error');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Error searching songs: Spotify error'));
    });
  });

  describe('listUserLibrary', () => {
    it('should return saved tracks on success', async () => {
      const mockLibrary = { items: [{ track: { name: 'Saved Song' } }] };
      mockSpotifyApi.getMySavedTracks.mockResolvedValue({
        body: mockLibrary as unknown as SpotifyApi.UsersSavedTracksResponse,
        headers: {},
        statusCode: 200,
      });

      const result = await service.listUserLibrary(5, 0);

      expect(mockSpotifyApi.getMySavedTracks).toHaveBeenCalledWith({ limit: 5, offset: 0 });
      expect(result).toEqual(mockLibrary);
    });

    it('should throw error and log it on failure', async () => {
      const error = new Error('Auth error');
      mockSpotifyApi.getMySavedTracks.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await expect(service.listUserLibrary()).rejects.toThrow('Auth error');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Error listing user library: Auth error'));
    });
  });

  describe('createPlaylist', () => {
    it('should create a playlist and return it on success', async () => {
      const mockPlaylist = { id: 'playlist-id', name: 'New Playlist' };
      mockSpotifyApi.createPlaylist.mockResolvedValue({
        body: mockPlaylist as unknown as SpotifyApi.CreatePlaylistResponse,
        headers: {},
        statusCode: 200,
      });

      const result = await service.createPlaylist('New Playlist', 'Description', true);

      expect(mockSpotifyApi.createPlaylist).toHaveBeenCalledWith('New Playlist', {
        description: 'Description',
        public: true,
      });
      expect(result).toEqual(mockPlaylist);
    });

    it('should throw error and log it on failure', async () => {
      const error = new Error('Creation failed');
      mockSpotifyApi.createPlaylist.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await expect(service.createPlaylist('Name')).rejects.toThrow('Creation failed');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Error creating playlist: Creation failed'));
    });
  });
});
