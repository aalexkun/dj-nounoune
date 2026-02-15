import { CommandRunner, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { FfprobeService } from '../../services/ffprobe/ffprobe.service';
import { MusicDbService } from '../../services/music-db/music-db.service';
import { AppService } from '../../app.service';
import { extname } from 'path';

interface EnrichCommandOptions {
  ffprobe?: boolean;
  ai?: boolean;
}

@SubCommand({
  name: 'enrich',
  description: 'Enrich the songs collection with technical metadata from ffprobe.',
})
export class EnrichCommand extends CommandRunner {
  private readonly logger = new Logger(EnrichCommand.name);

  constructor(
    private ffprobeService: FfprobeService,
    private musicDbService: MusicDbService,
    private appService: AppService,
  ) {
    super();
  }

  async run(inputs: string[], options: EnrichCommandOptions): Promise<void> {
    const songs = await this.musicDbService.getAllSongs();
    const rootPath = this.appService.getLibraryRootPath();

    for (const song of songs) {
      const filePath = song.source.find((s) => s.name === 'file')?.sourceId;
      const probeData = await this.ffprobeService.getTechnicalInfo(`${rootPath}${filePath}`);

      const audioStream = probeData.streams.find((s) => s.codec_type === 'audio');
      if (!audioStream) {
        throw new Error('No audio stream found in file');
      }

      const sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0;

      let bitDepth = 0;
      if (audioStream.bits_per_raw_sample) {
        bitDepth = parseInt(audioStream.bits_per_raw_sample, 10);
      } else if (audioStream.bits_per_sample) {
        bitDepth = audioStream.bits_per_sample;
      }

      const isHighRes = bitDepth > 16 || sampleRate > 48000;
      const isCdQuality = bitDepth >= 16 && sampleRate >= 44100;

      song.technical_info = {
        ...song.technical_info,
        encoding: audioStream.codec_name,
        size: probeData.format.size ? parseInt(probeData.format.size, 10) : 0,
        duration: parseFloat(probeData.format.duration || audioStream.duration || '0'),
        bitrate: parseInt(probeData.format.bit_rate || audioStream.bit_rate || '0'),
        sample_rate: sampleRate,
        bit_depth: bitDepth || 16,
        extension: extname(probeData.format.filename).replace('.', ''),
        is_high_res: isHighRes,
        is_cd_quality: isCdQuality,
      };

      try {
        await this.musicDbService.upsertSong(song);
      } catch (e) {
        this.logger.error(e);
      }
    }
  }
}
