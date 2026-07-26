import { Agent,  ReadonlyAgentCache } from '../../agent';
import { Logger } from '@nestjs/common';
import { ToolsService } from '../../tools.service';
import { PromptusRequest } from '../../promptus.request';
import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { CreatePlaylistRequest } from './request/create-playlist.request';
import { CreatePlaylistResponse } from './response/create-playlist.response';
import { WhatIsPlayingRequest } from './request/what-is-playing.request';
import { WhatIsPlayingResponse } from './response/what-is-playing.response';
import { CategorisePlaylistRequest } from './request/categorise-playlist.request';
import { CategorisePlaylistResponse } from './response/categorise-playlist.response';
import { FindBestArrangementRequest } from './request/find-best-arrangement.request';
import { FindBestArrangementResponse } from './response/find-best-arrangement.response';
import { PostFilteringRequest } from './request/post-filtering.request';
import { PostFilteringResponse } from './response/post-filtering.response';
import { BrowseDatabaseRequest } from './request/browse-database.request';
import { BrowseDatabaseResponse } from './response/browse-database.response';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatStatusResponseEvent, ChatStatusResponseEventName } from '../../../chat/chat.event';
import { ProfilerService } from '../../../profiler/profiler.service';
import { FileService } from '../../../file/file.service';
import { GenerateQueryWithCacheRequest } from './request/generate-query-with-cache.request';
import { GenerateQueryWithCacheResponse } from './response/generate-query-with-cache.response';
import { MusicDbService, PopulatedSong } from '../../../music-db/music-db.service';
import { OpensearchService } from '../../../opensearch/opensearch.service';

export type TechnicalInfo = {
  size?: number;
  encoding?: string;
  bitrate?: number;
  sample_rate?: number;
  is_high_res?: boolean;
  is_cd_quality?: boolean;
  duration?: number;
  bit_depth?: number;
  extension?: string;
  bpm?: number;
};

export type PlaySource = {
  sourceId: string;
  name: 'qobuz' | 'file' | 'spotify';
  technical_info?: TechnicalInfo;
};

export type MusicSearchResult = {
  id: string;
  source: PlaySource[];
  title: string;
  artist: string;
  album: string;
};

export const PopulatedSongToMusicSearchResultSchema = z.object({
  id: z.any().transform((val) => val.toString()),
  source: z.array(
    z.object({
      sourceId: z.string().optional().default(''),
      name: z.enum(['file', 'spotify', 'qobuz'], {
        message: 'source name is not valid',
      }),
    }).passthrough()
  ).transform((sources) =>
    sources.map((source) => ({
      sourceId: source.sourceId || '',
      name: source.name,
    }))
  ),
  title: z.string(),
  artist: z.object({ artist: z.string() }).transform((val) => val.artist),
  album: z.object({ title: z.string() }).transform((val) => val.title),
});

export function isMusicSearchResult(obj: unknown): obj is MusicSearchResult {
  // Check if it's a non-null object
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  // Cast to a record to check properties safely
  const record = obj as Record<string, unknown>;

  // Validate that all required properties exist and are strings
  return (
    typeof record.id === 'string' &&
    Array.isArray(record.source) &&
    record.source.every(
      (src: any) =>
        typeof src === 'object' &&
        src !== null &&
        typeof src.sourceId === 'string' &&
        (src.name === 'qobuz' || src.name === 'file' || src.name === 'spotify'),
    ) &&
    typeof record.title === 'string' &&
    typeof record.artist === 'string' &&
    typeof record.album === 'string'
  );
}

export class DiscJockeyAgent extends Agent {
  name = 'MusicSearchAgent';
  protected readonly logger = new Logger(this.name);
  protected cache: ReadonlyAgentCache = {
    name: 'dj-nounoune-cache',
    file: `files/dj-nounoune-cache`,
    fileMineType: 'text/plain',
    model: 'gemini-flash-latest',
    systemInstruction: '',
    cacheContent: undefined,
  };

  constructor(
    apiKey: string,
    toolService: ToolsService,
    protected profilerService: ProfilerService,
    protected fileService: FileService,
    protected musicDBService: MusicDbService,
    protected opensearchService: OpensearchService,
    protected eventEmitter: EventEmitter2,
  ) {
    super();
    this.initialiseAgent(apiKey, toolService, eventEmitter);
  }

  /**
   * [Nest] 59588  - 07/01/2026, 7:28:22 PM   ERROR [PromptusService] ApiError: {"error":{"code":403,"message":"CachedContent not found (or permission denied)","status":"PERMISSION_DENIED"}}
   *     at throwErrorIfNotOK (C:\Users\Alexandre\WebstormProjects\dj-nounoune\node_modules\@google\genai\dist\node\index.cjs:12224:30)
   *     at processTicksAndRejections (node:internal/process/task_queues:105:5)
   * @param naturalLanguageRequest
   * @param sessionId
   */
  async createPlaylist(naturalLanguageRequest: string, sessionId?: string): Promise<MusicSearchResult[]> {
    if (!sessionId) {
      throw new Error('sessionId is required to createPlaylist');
    }



    if (!this.cache.cacheContent || new Date(this.cache.cacheContent?.expireTime || 0).getTime() < new Date().getTime()) {
      const dbProfile = await this.profilerService.getDatabaseProfileForPrompt();
      await this.fileService.saveFile(this.cache.name, dbProfile);

      const cacheContent = await this.cacheHandler.cache(this.cache);
      if (!cacheContent || !cacheContent.expireTime) {
        const error = 'Cache Creation failed. Please check cache content and cache name.';
        this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent(error, sessionId));

        throw new Error(error);
      }
      this.cache.cacheContent = cacheContent;
      }

    const generateQueryWithCacheRequest = new GenerateQueryWithCacheRequest(naturalLanguageRequest, this.cache.cacheContent);
    const generateQueryWithCacheResponse = await this.generate(generateQueryWithCacheRequest, sessionId);

    this.logger.log(JSON.stringify(generateQueryWithCacheResponse.aggregate, null, 2));
    this.logger.log(JSON.stringify(generateQueryWithCacheResponse.fulltext, null, 2))

    let musicResult = new Map<string, PopulatedSong | null>();
    if (generateQueryWithCacheResponse.aggregate) {
      const searchResult = await this.musicDBService.aggregate('songs', generateQueryWithCacheResponse.aggregate);
      searchResult.map((song) => !musicResult.has(song._id.toString()) && musicResult.set(song._id.toString(), null));
    }

    if (generateQueryWithCacheResponse.fulltext && generateQueryWithCacheResponse.fulltext.length > 0) {
      const fullTextResult = await this.opensearchService.fuzzySearch(generateQueryWithCacheResponse.fulltext);
      if (fullTextResult && fullTextResult.hits.hits.length > 0) {
        fullTextResult.hits.hits.map(
          (song) =>
            song._score > 0.5 && // todo test that
            !musicResult.has(song._id.toString()) &&
            musicResult.set(song._id.toString(), null),
        );
      }
    }

    if (musicResult.size == 0) {
      this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent('No Songs Found', sessionId));
      return [];
    }

    const populatedSongs = await this.musicDBService.getPopulatedSongsByIds(Array.from(musicResult.keys()));
    if (!populatedSongs || populatedSongs.length == 0) {
      throw new Error('getPopulatedSongsByIds resulted in error. length ');
    }

    const arrangePopulatedSongs = await this.findBestArrangement(populatedSongs);

    const playlistItemMsg = arrangePopulatedSongs.map((item, index) => `${index + 1} - [${item.artist.artist}] ${item.album.title} - ${item.title}`).join('\n');
    this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent(playlistItemMsg, sessionId));



    return z.array(PopulatedSongToMusicSearchResultSchema).parse(arrangePopulatedSongs);
  }

  private async findBestArrangement(populatedSongs: PopulatedSong[]): Promise<PopulatedSong[]> {
    let arrangedSongs: PopulatedSong[] = [];
    let aiRequestMap = new Map<number, string>();
    // Generate the map for efficient token usage
    let prompt = 'id|artist|album|title|emotion|pace|disc_number|language|country\n';
    populatedSongs.forEach((song, index) => {
      aiRequestMap.set(index+1, song.id.toString());
      prompt += `${index+1}|${song.artist.artist}|${song.album.title}${song.title}|${song.emotion}|${song.pace}|${song.disc_number}|${song.language}|${song.country}\n`;
    });

    const response = await this.generate(new FindBestArrangementRequest(prompt));

    response.items.forEach((item) => {
      const id = aiRequestMap.get(Number(item));
      if (id) {
        const song = populatedSongs.find((song) => song.id.toString() === id);
        if (song){
          arrangedSongs.push(song);
        }
      }
    });

    return arrangedSongs;
  }

  async whatIsPlaying(request: string, sessionId?: string) {
    const wip = new WhatIsPlayingRequest(request);
    return await this.generate(wip, sessionId);
  }

  async categorisePlaylist(request: string, sessionId?: string) {
    const djRequest = new CategorisePlaylistRequest(request);
    return await this.generate(djRequest, sessionId);
  }

  async postFiltering(request: string, sessionId?: string) {
    const djRequest = new PostFilteringRequest(request);
    return await this.generate(djRequest, sessionId);
  }

  async browseDatabase(request: string, sessionId?: string) {
    const djRequest = new BrowseDatabaseRequest(request);
    const response = await this.generate(djRequest, sessionId);

    if (sessionId && response.description) {
      this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent(response.description, sessionId));
    }

    if (sessionId && response.items.length > 0) {
      const itemsMsg = response.items
        .map((item, index) => {
          let line = `${index + 1} - [${item.artist}]`;
          if (item.title) line += ` ${item.title}`;
          if (item.album) line += ` (${item.album})`;
          return line;
        })
        .join('\n');
      this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent(itemsMsg, sessionId));
    }

    return response;
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof CreatePlaylistRequest) {
      return new CreatePlaylistResponse(response) as ReqType;
    }
    if (request instanceof WhatIsPlayingRequest) {
      return new WhatIsPlayingResponse(response) as ReqType;
    }
    if (request instanceof CategorisePlaylistRequest) {
      return new CategorisePlaylistResponse(response) as ReqType;
    }
    if (request instanceof FindBestArrangementRequest) {
      return new FindBestArrangementResponse(response) as ReqType;
    }
    if (request instanceof PostFilteringRequest) {
      return new PostFilteringResponse(response) as ReqType;
    }
    if (request instanceof BrowseDatabaseRequest) {
      return new BrowseDatabaseResponse(response) as ReqType;
    }

    if (request instanceof GenerateQueryWithCacheRequest) {
      return new GenerateQueryWithCacheResponse(response) as ReqType;
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }
}
