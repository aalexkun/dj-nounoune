import { SongSource } from '../../schemas/source.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';
import { existingSourceBeatsFile, fileQuality, lowQualityReason, providerBeatsFile, providersWorthAsking } from './quality.util';

function file(technical?: Partial<TechnicalInfo>): SongSource {
  return {
    name: 'file',
    sourceId: '/music/a.mp3',
    filename: 'a.mp3',
    technical_info: technical ? (technical as TechnicalInfo) : undefined,
  };
}

function stream(name: 'qobuz' | 'spotify' | 'youtube', technical: Partial<TechnicalInfo>): SongSource {
  return { name, sourceId: 'x', filename: 'x', technical_info: technical as TechnicalInfo };
}

describe('quality.util — the upgrade ladder', () => {
  describe('providersWorthAsking', () => {
    it('asks only Qobuz for a 320 kbps mp3', () => {
      expect(providersWorthAsking(fileQuality(file({ extension: 'mp3', bitrate: 320000 })))).toEqual(['qobuz']);
    });

    it('asks Qobuz and Spotify, not YouTube, for a 256 kbps mp3', () => {
      expect(providersWorthAsking(fileQuality(file({ extension: 'mp3', bitrate: 256000 })))).toEqual(['qobuz', 'spotify']);
    });

    it('asks all three for a 128 kbps mp3', () => {
      expect(providersWorthAsking(fileQuality(file({ extension: 'mp3', bitrate: 128000 })))).toEqual(['qobuz', 'spotify', 'youtube']);
    });

    it('asks Qobuz and Spotify for a lossy file with no bitrate', () => {
      expect(providersWorthAsking(fileQuality(file({ extension: 'mp3' })))).toEqual(['qobuz', 'spotify']);
    });

    it('asks only Qobuz for a file with no technical info', () => {
      expect(providersWorthAsking(fileQuality(file()))).toEqual(['qobuz']);
    });

    it('asks only Qobuz for a lossless container below CD quality', () => {
      expect(providersWorthAsking(fileQuality(file({ extension: 'flac', is_cd_quality: false, sample_rate: 22050 })))).toEqual(['qobuz']);
    });
  });

  describe('providerBeatsFile', () => {
    it('never lets a lossy stream replace a file that might be lossless', () => {
      expect(providerBeatsFile('spotify', {})).toBe(false);
      expect(providerBeatsFile('youtube', { lossless: undefined, bitrate: 128000 })).toBe(false);
    });

    it('requires a strictly higher bitrate, never equal', () => {
      expect(providerBeatsFile('spotify', { lossless: false, bitrate: 320000 })).toBe(false);
      expect(providerBeatsFile('youtube', { lossless: false, bitrate: 256000 })).toBe(false);
      expect(providerBeatsFile('youtube', { lossless: false, bitrate: 255000 })).toBe(true);
    });
  });

  describe('existingSourceBeatsFile', () => {
    const lossy128 = fileQuality(file({ extension: 'mp3', bitrate: 128000 }));
    const lossy320 = fileQuality(file({ extension: 'mp3', bitrate: 320000 }));

    it('reuses a qobuz source over any lossy file', () => {
      expect(existingSourceBeatsFile(stream('qobuz', { is_cd_quality: true }), lossy320)).toBe(true);
    });

    it('reuses a spotify source over a 128 kbps file but not over a 320 kbps one', () => {
      const spotify = stream('spotify', { bitrate: 320000, is_cd_quality: false });
      expect(existingSourceBeatsFile(spotify, lossy128)).toBe(true);
      expect(existingSourceBeatsFile(spotify, lossy320)).toBe(false);
    });

    it('ignores a file source and an unknown provider', () => {
      expect(existingSourceBeatsFile(file({ extension: 'flac', is_cd_quality: true }), lossy128)).toBe(false);
    });
  });

  describe('lowQualityReason', () => {
    it('leaves a CD quality file alone', () => {
      expect(lowQualityReason(file({ extension: 'flac', is_cd_quality: true }))).toBeNull();
    });

    it('names the format and bitrate of a lossy file', () => {
      expect(lowQualityReason(file({ extension: 'mp3', bitrate: 192000 }))).toBe('lossy mp3 @ 192kbps');
    });
  });
});
