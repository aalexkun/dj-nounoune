import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { ShellService } from '../../services/shell/shell.service';
import { MusicDbService, PopulatedSong } from '../../services/music-db/music-db.service';
import { AppService } from '../../app.service';
import { extname } from 'path';
import { SongDocument } from '../../schemas/song.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';

import { ParsedPsvRow, PsvService } from '../../services/transformation/psv.service';
import { FileService } from '../../services/file/file.service';
import { chunkArray, getInclusivePaginationRanges } from '../../utils/array.utils';
import { PromptusService } from '../../services/promptus/promptus.service';
import { EnrichPromptusRequest } from '../../services/promptus/request/enrich-promptus.request';
import { enrichPromptusCachePrompt } from '../../services/promptus/request/enrich-promptus.cache.prompt';
import { CachedContent } from '@google/genai';
import { z } from 'zod';

export const AiEnrichedSongSchema = z.object({
  _id: z.string().optional(),
  genre: z.string().optional(),
  language: z.string().optional(),
  country: z.string().optional(),
  emotion: z.string().optional(),
  pace: z.string().optional(),
  year: z.string().optional(),
});

export type AiEnrichedSong = z.infer<typeof AiEnrichedSongSchema>;

interface EnrichCommandOptions {
  ai?: boolean;
  clearCache?: boolean;
  Ffprobe?: boolean;
  bpm?: boolean;
  createdAt?: Date;
  limit?: number;
  batch?: number;
}

@SubCommand({
  name: 'enrich',
  description: 'Enrich the songs collection with technical metadata from ffprobe.',
})
export class EnrichCommand extends CommandRunner {
  private readonly logger = new Logger(EnrichCommand.name);
  private readonly cacheName = 'enrich-instruction';

  constructor(
    private shellService: ShellService,
    private musicDbService: MusicDbService,
    private appService: AppService,
    private promptusService: PromptusService,
    private fileService: FileService,
  ) {
    super();
  }

  async run(inputs: string[], options: EnrichCommandOptions): Promise<void> {
    this.logger.log(`Starting enrich command with options: ${JSON.stringify(options)}`);

    if (options.clearCache) {
      this.logger.log('Clearing cache requested...');
      await this.promptusService.cacheHandler.clearCache(this.cacheName);
      this.logger.log('Cache cleared successfully.');
      return;
    }

    // Sync queue
    this.logger.log('Syncing enrich queue...');
    await this.musicDbService.syncEnrich();

    if (options.Ffprobe) {
      this.logger.log(`Processing songs for Ffprobe enrichment...`);
      const queuedFfprobeCursor = this.musicDbService.getEnrichCursor('ffprobe', 'queued', options.limit);
      for await (const queueItem of queuedFfprobeCursor) {
        const songId = queueItem._id;
        const song = await this.musicDbService.getSongById(songId.toString());
        if (!song) continue;

        const fileSource = song.source.find((s) => s.name === 'file');
        if (!fileSource || !fileSource.sourceId) {
          await this.musicDbService.updateEnrichStatus(songId, 'ffprobe', 'notApplicable', 'no file source');
          continue;
        }

        try {
          const updatedSong = await this.updateFfprobe(song);
          await this.musicDbService.upsertSong(updatedSong);
          await this.musicDbService.updateEnrichStatus(songId, 'ffprobe', 'completed');
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          await this.musicDbService.updateEnrichStatus(songId, 'ffprobe', 'notApplicable', errorMessage);
        }
      }
    }

    if (options.bpm) {
      this.logger.log(`Processing songs for BPM enrichment...`);
      const queuedBpmCursor = this.musicDbService.getEnrichCursor('bpm', 'queued', options.limit);
      for await (const queueItem of queuedBpmCursor) {
        const songId = queueItem._id;
        const song = await this.musicDbService.getSongById(songId.toString());
        if (!song) continue;

        const fileSource = song.source.find((s) => s.name === 'file');
        if (!fileSource || !fileSource.sourceId) {
          await this.musicDbService.updateEnrichStatus(songId, 'bpm', 'notApplicable', 'no file source');
          continue;
        }

        try {
          const updatedSong = await this.updateBpm(song);
          await this.musicDbService.upsertSong(updatedSong);
          await this.musicDbService.updateEnrichStatus(songId, 'bpm', 'completed');
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          await this.musicDbService.updateEnrichStatus(songId, 'bpm', 'notApplicable', errorMessage);
        }
      }
    }

    if (options.ai) {
      this.logger.log(`Processing songs for AI enrichment...`);
      const queuedAiCursor = this.musicDbService.getEnrichCursor('ai', 'queued', options.limit);
      let batchIds: string[] = [];

      // Add system instruction caching

      const template = new EnrichPromptusRequest('Process songs from range: {{start}} to {{end}}');
      await this.fileService.saveFile(this.cacheName, enrichPromptusCachePrompt);
      const cache = await this.promptusService.cacheHandler.cache(`files/${this.cacheName}`, this.cacheName, 'text/plain', template.model, '');

      const processAiBatch = async (ids: string[]) => {
        const toEnrichAi = await this.musicDbService.getPopulatedSongsByIds(ids);
        if (toEnrichAi.length > 0 && cache) {
          const aiEnrichedSongs = await this.updateAi(toEnrichAi, cache);

          for (const aiSong of aiEnrichedSongs) {
            const songId = aiSong._id;
            if (!songId) continue;

            const songToUpdate = await this.musicDbService.getSongById(songId.toString());
            if (songToUpdate) {
              if (aiSong.genre) songToUpdate.genre = aiSong.genre;
              if (aiSong.language) songToUpdate.language = aiSong.language;
              if (aiSong.country) songToUpdate.country = aiSong.country;
              if (aiSong.emotion) songToUpdate.emotion = aiSong.emotion;
              if (aiSong.pace) songToUpdate.pace = aiSong.pace;
              if (aiSong.year) songToUpdate.year = aiSong.year;

              try {
                await this.musicDbService.upsertSong(songToUpdate);
                await this.musicDbService.updateEnrichStatus(songId, 'ai', 'completed', undefined, aiSong);
              } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                await this.musicDbService.updateEnrichStatus(songId, 'ai', 'notApplicable', errorMessage);
              }
            }
          }
        }
      };

      for await (const queueItem of queuedAiCursor) {
        batchIds.push(queueItem._id.toString());
        if (batchIds.length >= (options.batch ?? 100)) {
          await processAiBatch(batchIds);
          batchIds = [];
        }
      }

      if (batchIds.length > 0) {
        await processAiBatch(batchIds);
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
          song.source[0].technical_info = song.source[0].technical_info ?? ({} as TechnicalInfo);
          song.source[0].technical_info.bpm = Math.round(bpm);
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
    const fileSource = song.source.find((s) => s.name === 'file');

    if (!fileSource || !fileSource.sourceId) {
      this.logger.log(`Skipping ffprobe for song "${song.title}": no file source found`);
      return song;
    }

    const filePath = fileSource.sourceId;
    const probeData = await this.shellService.getTechnicalInfo(`${rootPath}${filePath}`);

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

    fileSource.technical_info = {
      ...(fileSource.technical_info ?? {}),
      encoding: audioStream.codec_name,
      size: probeData.format.size ? parseInt(probeData.format.size, 10) : 0,
      duration: parseFloat(probeData.format.duration || audioStream.duration || '0'),
      bitrate: parseInt(probeData.format.bit_rate || audioStream.bit_rate || '0'),
      sample_rate: sampleRate,
      bit_depth: bitDepth || 16,
      extension: extname(probeData.format.filename).replace('.', ''),
      is_high_res: isHighRes,
      is_cd_quality: isCdQuality,
    } as TechnicalInfo;

    return song;
  }

  private async updateAi(populatedSong: PopulatedSong[], cache: CachedContent): Promise<AiEnrichedSong[]> {
    const indexMap = new Map<string, string>();

    const songsToEnrich: Partial<ParsedPsvRow>[] = populatedSong.map((song, index) => {
      const sequentialId = index.toString();
      const originalId = song?._id?._id?.toString() ?? song._id?.toString() ?? '';
      
      indexMap.set(sequentialId, originalId);
      
      return {
        _id: sequentialId,
        title: song.title,
        artist: song.artist.artist,
        album: song.album.title,
      };
    });

    // Save the file as tmp and cache it for the request

    const enrichRequests: EnrichPromptusRequest[] = [];
    const batch: EnrichPromptusRequest[] = [];
    const pageSize = 10;

    if (cache) {

      for (const batchToSend of chunkArray(songsToEnrich, pageSize)) {
        const psvData = batchToSend.map((song) => `${song._id}|${song.title}|${song.artist}|${song.album}`).join('\n');
        const enrichRequest = new EnrichPromptusRequest(psvData);
        enrichRequest.cache = cache;
        enrichRequests.push(enrichRequest);
      }

      const aiResponses = await this.promptusService.parallelGenerate(enrichRequests, 5);

      let result: AiEnrichedSong[] = [];
      for (const response of aiResponses) {
        if (response?.results) {
          const remapGenre = response.results.map((s) => ({
            _id: indexMap.get(s.id),
            genre: s.genre,
            language: s.language,
            country: s.country,
            emotion: s.emotion,
            pace: s.pace,
            year: s.year,
          }));
          
          const parsedRemap = z.array(AiEnrichedSongSchema).parse(remapGenre);
          result = [...result, ...parsedRemap];
        } else {
          this.logger.error(`Failed to parse AI response: ${JSON.stringify(response)}`);
        }
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

  @Option({
    flags: '-l, --limit [limit]',
    description: 'Limit the number of items to process',
  })
  parseLimit(limit: string): number {
    return parseInt(limit, 10);
  }

  @Option({
    flags: '-b, --batch [batch]',
    description: 'Number of items to load before processing',
    defaultValue: 100,
  })
  parseBatch(batch: string): number {
    return parseInt(batch, 10);
  }

  @Option({
    flags: ', --createdAt [createdAt]',
    description: 'Filter songs created after a date (yyyy-mm-dd)',
  })
  parseCreatedAt(createdAt: string): Date {
    return new Date(createdAt);
  }
}
