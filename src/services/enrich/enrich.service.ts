import { Injectable, Logger } from '@nestjs/common';
import { extname } from 'path';
import { CachedContent } from '@google/genai';
import { z } from 'zod';

import { AppService } from '../../app.service';
import { ShellService } from '../shell/shell.service';
import { FileService } from '../file/file.service';
import { OpensearchService } from '../opensearch/opensearch.service';
import { MusicDbService, PopulatedSong } from '../music-db/music-db.service';
import { ReadonlyAgentCache } from '../promptus/agent';
import { ToolsService } from '../promptus/tools.service';
import { EnrichAgent } from '../promptus/agent/enrich/enrich.agent';
import { EnrichMetadataRequest } from '../promptus/agent/enrich/request/enrich-metadata.request';
import { enrichMetadataCachePrompt } from '../promptus/agent/enrich/request/enrich-metadata.cache.prompt';
import { LyricSemanticRequest } from '../promptus/agent/enrich/request/lyric-semantic.request';
import { ParsedPsvRow } from '../transformation/psv.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SongDocument } from '../../schemas/song.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';
import { chunkArray } from '../../utils/array.utils';
import { getErrorMessage } from '../../utils/error.utils';

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

/** Songs pulled from the queue before one round of lyric requests is fired. */
const LYRIC_BATCH_SIZE = 20;

/** Lyric requests in flight at once. One song per request, so this is songs per round too. */
const LYRIC_CONCURRENCY = 5;

/** What one enrich pass should do. Every enricher is opt-in. */
export interface EnrichOptions {
  /** Ask Gemini for genre/language/country/emotion/pace/year. */
  ai?: boolean;
  /** Read technical info out of the local file with ffprobe. */
  ffprobe?: boolean;
  /** Detect the beats per minute of the local file. */
  bpm?: boolean;
  /** Distil each song's lyrics into one sentence for semantic search. */
  lyricSemantic?: boolean;
  /** Filter songs created after this date. */
  createdAt?: Date;
  /** Cap the number of queued songs pulled per enricher. */
  limit?: number;
  /** Songs accumulated before one round of requests. Defaults to 100 for metadata, 20 for lyrics. */
  batch?: number;
  /** Lyric requests in flight at once. Defaults to 5. */
  concurrency?: number;
}

/**
 * Fills in what the importers could not.
 *
 * Songs land in the `enrich` queue on import; this service drains that queue
 * through three independent enrichers — ffprobe, bpm and the AI pass — marking
 * each song `completed` or `notApplicable` as it goes, so a rerun never redoes
 * settled work. Both the CLI (`music enrich`) and `EnrichScheduler` call
 * straight into `run`, which is the whole point of it living here: a `@Cron`
 * on a `CommandRunner` is never discovered in web mode, where the CLI module
 * is deliberately absent.
 */
@Injectable()
export class EnrichService {
  private readonly logger = new Logger(EnrichService.name);
  private readonly cacheName = 'enrich-instruction';
  private readonly enrichAgent: EnrichAgent;

  constructor(
    private readonly shellService: ShellService,
    private readonly musicDbService: MusicDbService,
    private readonly appService: AppService,
    private readonly fileService: FileService,
    private readonly opensearchService: OpensearchService,
    toolsService: ToolsService,
    eventEmitter: EventEmitter2,
  ) {
    // Plain-`new`ed like every other agent, but owned here rather than by ToolsService: it is
    // never exposed as a tool. Its own throttle bucket means a long batch cannot starve chat.
    this.enrichAgent = new EnrichAgent(appService.getGenAiApiKey(), toolsService, eventEmitter);
  }

  /** Drop the Gemini context cache holding the enrich instructions. */
  async clearCache(): Promise<void> {
    this.logger.log('Clearing cache requested...');
    await this.enrichAgent.cacheHandler.clearCache(this.cacheName);
    this.logger.log('Cache cleared successfully.');
  }

  async run(options: EnrichOptions): Promise<void> {
    this.logger.log(`Starting enrich run with options: ${JSON.stringify(options)}`);

    // Sync queue
    this.logger.log('Syncing enrich queue...');
    await this.musicDbService.syncEnrich();

    if (options.ffprobe) {
      await this.runFfprobe(options);
    }

    if (options.bpm) {
      await this.runBpm(options);
    }

    if (options.ai) {
      await this.runAi(options);
    }

    if (options.lyricSemantic) {
      await this.runLyricSemantic(options);
    }
  }

  private async runFfprobe(options: EnrichOptions): Promise<void> {
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
        await this.musicDbService.updateEnrichStatus(songId, 'ffprobe', 'notApplicable', getErrorMessage(e));
      }
    }
  }

  private async runBpm(options: EnrichOptions): Promise<void> {
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
        await this.musicDbService.updateEnrichStatus(songId, 'bpm', 'notApplicable', getErrorMessage(e));
      }
    }
  }

  private async runAi(options: EnrichOptions): Promise<void> {
    this.logger.log(`Processing songs for AI enrichment...`);
    const queuedAiCursor = this.musicDbService.getEnrichCursor('ai', 'queued', options.limit);
    let batchIds: string[] = [];

    const template = new EnrichMetadataRequest('Process songs from range: {{start}} to {{end}}');
    await this.fileService.saveFile(this.cacheName, enrichMetadataCachePrompt);
    // Add system instruction caching
    const cacheSettings: ReadonlyAgentCache = {
      name: this.cacheName,
      file: `files/${this.cacheName}`,
      fileMineType: 'text/plain',
      model: template.model,
      cacheInstruction: '', // the instruction here is the cached file itself
      cacheContent: undefined,
    };

    const cache = await this.enrichAgent.cacheHandler.cache(cacheSettings);

    for await (const queueItem of queuedAiCursor) {
      batchIds.push(queueItem._id.toString());
      if (batchIds.length >= (options.batch ?? 100)) {
        await this.processAiBatch(batchIds, cache);
        batchIds = [];
      }
    }

    if (batchIds.length > 0) {
      await this.processAiBatch(batchIds, cache);
    }
  }

  private async processAiBatch(ids: string[], cache: CachedContent | undefined): Promise<void> {
    const toEnrichAi = await this.musicDbService.getPopulatedSongsByIds(ids);
    if (toEnrichAi.length === 0 || !cache) {
      return;
    }

    const aiEnrichedSongs = await this.updateAi(toEnrichAi, cache);

    for (const aiSong of aiEnrichedSongs) {
      const songId = aiSong._id;
      if (!songId) continue;

      const songToUpdate = await this.musicDbService.getSongById(songId.toString());
      if (!songToUpdate) continue;

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
        await this.musicDbService.updateEnrichStatus(songId, 'ai', 'notApplicable', getErrorMessage(e));
      }
    }
  }

  private async runLyricSemantic(options: EnrichOptions): Promise<void> {
    this.logger.log(`Processing songs for lyric semantic enrichment...`);
    const queuedCursor = this.musicDbService.getEnrichCursor('lyric_semantic', 'queued', options.limit);
    let batchIds: string[] = [];

    for await (const queueItem of queuedCursor) {
      batchIds.push(queueItem._id.toString());
      if (batchIds.length >= (options.batch ?? LYRIC_BATCH_SIZE)) {
        await this.processLyricSemanticBatch(batchIds, options);
        batchIds = [];
      }
    }

    if (batchIds.length > 0) {
      await this.processLyricSemanticBatch(batchIds, options);
    }
  }

  /**
   * One request per song, `concurrency` of them in flight. The instruction fixes the output at a
   * single sentence, so there is nothing to gain from packing songs into one request the way the
   * metadata pass does.
   */
  private async processLyricSemanticBatch(ids: string[], options: EnrichOptions): Promise<void> {
    const songs = await this.musicDbService.getPopulatedSongsByIds(ids);

    // Requests are built from `songs`, not from `ids`: `getPopulatedSongsByIds` uses `$in` and
    // does not preserve the order it was given, and the results are zipped back by index.
    const requests = songs.map((song) => new LyricSemanticRequest(song.artist.artist, song.title));
    const responses = requests.length > 0 ? await this.enrichAgent.parallelGenerate(requests, options.concurrency ?? LYRIC_CONCURRENCY) : [];

    for (const [index, song] of songs.entries()) {
      const songId = song._id.toString();
      const response = responses[index];

      // `parallelGenerate` logs and swallows a failed request, leaving a hole in the array.
      // Leave the song queued so the next pass retries it.
      if (!response) continue;

      // Not asked for, but a blank answer must not be embedded — an empty string still produces
      // a vector, one that would sit in every kNN result.
      const semantic = response.semantic;
      if (!semantic) {
        await this.musicDbService.updateEnrichStatus(songId, 'lyric_semantic', 'notApplicable', 'blank answer');
        continue;
      }

      try {
        // Same write pattern as the other enrichers: re-read the plain SongDocument and upsert
        // that. The PopulatedSong in hand carries full artist/album documents where the schema
        // expects ObjectId refs.
        const songToUpdate = await this.musicDbService.getSongById(songId);
        if (!songToUpdate) continue;
        songToUpdate.lyric_semantic = semantic;
        await this.musicDbService.upsertSong(songToUpdate);
        await this.musicDbService.updateEnrichStatus(songId, 'lyric_semantic', 'completed', undefined, { semantic });
        this.logger.log(`${song.artist.artist} - ${song.title}: ${semantic}`);

        // The index copy follows the write. `indexSong` never throws, so an OpenSearch outage
        // cannot mark a song notApplicable - the next full reindex picks it up from Mongo.
        song.lyric_semantic = semantic;
        await this.opensearchService.indexSong(song);
      } catch (e) {
        await this.musicDbService.updateEnrichStatus(songId, 'lyric_semantic', 'notApplicable', getErrorMessage(e));
      }
    }

    // A queued id with no song behind it — a duplicate deleted by `music dedup process`, whose
    // enrich document nobody removed — would otherwise be re-fetched on every pass and hold a
    // --limit slot forever. Retire it.
    const found = new Set(songs.map((song) => song._id.toString()));
    for (const id of ids.filter((id) => !found.has(id))) {
      await this.musicDbService.updateEnrichStatus(id, 'lyric_semantic', 'notApplicable', 'song missing');
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
        this.logger.error(`Failed to execute bpm-tag for ${song.title}: ${getErrorMessage(err)}`);
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

    if (!cache) {
      throw new Error('No cache found for enrich songs library promptus');
    }

    const enrichRequests: EnrichMetadataRequest[] = [];
    const pageSize = 10;

    for (const batchToSend of chunkArray(songsToEnrich, pageSize)) {
      const psvData = batchToSend.map((song) => `${song._id}|${song.title}|${song.artist}|${song.album}`).join('\n');
      const enrichRequest = new EnrichMetadataRequest(psvData);
      enrichRequest.cache = cache;
      enrichRequests.push(enrichRequest);
    }

    const aiResponses = await this.enrichAgent.parallelGenerate(enrichRequests, 5);

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
  }
}
