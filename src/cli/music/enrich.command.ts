import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { ShellService } from '../../services/shell/shell.service';
import { MusicDbService, PopulatedSong } from '../../services/music-db/music-db.service';
import { AppService } from '../../app.service';
import { extname } from 'path';
import { SongDocument } from '../../schemas/song.schema';

import { ParsedPsvRow, PsvService } from '../../services/transformation/psv.service';
import { FileService } from '../../services/file/file.service';
import { getInclusivePaginationRanges } from '../../utils/array.utils';
import { PromptusService } from '../../services/promptus/promptus.service';
import { EnrichPromptusRequest } from '../../services/promptus/request/enrich-promptus.request';

interface EnrichCommandOptions {
  ai?: boolean;
  clearCache?: boolean;
  Ffprobe?: boolean;
  bpm?: boolean;
}

@SubCommand({
  name: 'enrich',
  description: 'Enrich the songs collection with technical metadata from ffprobe.',
})
export class EnrichCommand extends CommandRunner {
  private readonly logger = new Logger(EnrichCommand.name);
  private readonly cacheName = 'enrich-songs-library-psv';
  private readonly cacheFile = 'files/enrich-songs-library-psv';
  constructor(
    private shellService: ShellService,
    private musicDbService: MusicDbService,
    private appService: AppService,
    private promptusService: PromptusService,
    private psvSerive: PsvService,
    private fileService: FileService,
  ) {
    super();
  }

  async run(inputs: string[], options: EnrichCommandOptions): Promise<void> {
    this.logger.log(`Starting enrich command with options: ${JSON.stringify(options)}`);
    let aiEnrichedSongs: Partial<ParsedPsvRow>[] = [];

    if (options.clearCache) {
      this.logger.log('Clearing cache requested...');
      await this.promptusService.cacheHandler.clearCache(this.cacheName);
      this.logger.log('Cache cleared successfully.');
      return;
    }

    // Generate the PSV file for batch processing.
    if (options.ai) {
      this.logger.log('Fetching populated songs from MusicDbService for AI enrichment...');
      const populatedSong = await this.musicDbService.getAllPopulatedSongs();
      // aiEnrichedSongs = await this.updateAi(populatedSong);
    }

    const songs = await this.musicDbService.getAllSongs();
    for (let song of songs) {
      if (options.Ffprobe) {
        song = await this.updateFfprobe(song);
      }

      if (options.ai) {
        let aiEnrichedSong = aiEnrichedSongs.find((s) => s._id === song._id.toString());
        song.genre = aiEnrichedSong?.genre || song.genre;
      }

      if (options.bpm) {
        song = await this.updateBpm(song);
      }

      try {
        const dbResult = await this.musicDbService.upsertSong(song);
        this.logger.log(`Updated song ${dbResult.title} (${dbResult._id}) ${dbResult.genre}`);
      } catch (e) {
        this.logger.error(e);
      }
    }
  }

  private async updateBpm(song: SongDocument): Promise<SongDocument> {
    const rootPath = this.appService.getLibraryRootPath();
    const filePath = song.source.find((s) => s.name === 'file')?.sourceId;
    if (filePath) {
      try {
        const bpm = await this.shellService.executeBpmTag(`${rootPath}${filePath}`);
        if (bpm > 0) {
          song.technical_info.bpm = Math.round(bpm);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to execute bpm-tag for ${song.title}: ${errorMessage}`);
      }
    }
    return song;
  }

  private async updateFfprobe(song: SongDocument): Promise<SongDocument> {
    const rootPath = this.appService.getLibraryRootPath();
    const filePath = song.source.find((s) => s.name === 'file')?.sourceId;
    const probeData = await this.shellService.getTechnicalInfo(`${rootPath}${filePath}`);

    const audioStream = probeData.streams.find((s) => s.codec_type === 'audio');
    if (!audioStream) {
      throw new Error('No audio stream found in file');
    }

    const sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate, 3) : 0;

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

    return song;
  }

  private async updateAi(populatedSong: PopulatedSong[]): Promise<Partial<ParsedPsvRow>[]> {
    const indexMap = new Map<string, string>();

    const songsForPromptus: Partial<ParsedPsvRow>[] = populatedSong.map((song, index) => {
      const originalId = song?._id?._id.toString() || '';
      const sequentialId = (index++).toString();
      indexMap.set(sequentialId, originalId);
      return {
        _id: sequentialId,
        title: song.title,
        artist: song.artist.artist,
        album: song.album.title,
      };
    });

    // Save the file as tmp and cache it for the request
    await this.fileService.saveFile(this.cacheName, this.psvSerive.toPsv(songsForPromptus, true));

    const enrichRequests: EnrichPromptusRequest[] = [];
    const ranges = getInclusivePaginationRanges(songsForPromptus.length, 1000);
    //const ranges = getInclusivePaginationRanges(1204, 200);

    const template = new EnrichPromptusRequest('Process songs from range: {{start}} to {{end}}');
    const templateInstruction = template.context;
    const cache = await this.promptusService.cacheHandler.cache(this.cacheFile, this.cacheName, 'text/plain', template.model, templateInstruction);

    if (cache) {
      for (const range of ranges) {
        const enrichRequest = new EnrichPromptusRequest('Process rows ' + range.join(' to ') + '');
        enrichRequest.cache = cache;
        enrichRequests.push(enrichRequest);
      }

      const aiResponses = await this.promptusService.parallelGenerate(enrichRequests);

      let result: Partial<ParsedPsvRow>[] = [];
      for (const response of aiResponses) {
        const remapGenre = response.genre.map((s) => ({ _id: indexMap.get(s.id), genre: s.genre }));
        result = [...result, ...remapGenre];
      }

      return result;
    } else {
      throw new Error('No cache found for enrich songs library promptus');
    }
  }

  @Option({
    flags: ', --ai',
    description: 'Run enrich with ai prompt',
    defaultValue: false,
  })
  parseAi(): boolean {
    return true;
  }

  @Option({
    flags: ', --bpm',
    description: 'Run enrich to get songs bpm',
    defaultValue: false,
  })
  parseBpm(): boolean {
    return true;
  }

  @Option({
    flags: ', --Ffprobe',
    description: 'runs ffprobe',
    defaultValue: false,
  })
  parseFfprobe(): boolean {
    return true;
  }

  @Option({
    flags: ', --clear-cache',
    description: 'Clear current file and prompt cache. TTL 15m default',
    defaultValue: false,
  })
  parseClearCache(): boolean {
    return true;
  }
}
