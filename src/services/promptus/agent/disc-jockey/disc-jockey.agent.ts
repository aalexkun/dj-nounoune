import { GEMINI_FLASH } from '../../config';
import { Agent, ReadonlyAgentCache } from '../../agent';
import { Logger } from '@nestjs/common';
import { ToolsService } from '../../tools.service';
import { PromptusRequest } from '../../promptus.request';
import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { Types } from 'mongoose';
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
import { AlbumCoverRequest } from './request/album-cover.request';
import { AlbumCoverResponse } from './response/album-cover.response';
import { ArtistPerformanceRequest } from './request/artist-performance.request';
import { ArtistPerformanceResponse } from './response/artist-performance.response';
import { MusicTalkRequest } from './request/music-talk.request';
import { MusicTalkResponse } from './response/music-talk.response';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatStatusResponseEvent, ChatStatusResponseEventName } from '../../../chat/chat.event';
import { ProfilerService } from '../../../profiler/profiler.service';
import { FileService } from '../../../file/file.service';
import { GenerateQueryWithCacheRequest } from './request/generate-query-with-cache.request';
import { generateQueryWithCache } from './request/generate-query-with-cache.prompt';
import { GenerateQueryWithCacheResponse } from './response/generate-query-with-cache.response';
import { MusicDbService, PopulatedSong } from '../../../music-db/music-db.service';
import { OpensearchService } from '../../../opensearch/opensearch.service';
import { RedisCacheKey, RedisCacheService } from '../../../redis-cache/redis-cache.service';
import { filterActiveSources } from '../../../../config/active-source.util';

/**
 * Label shared by every candidate the lyric-semantic branch surfaces. The intent string is the
 * grouping key in the post-filter prompt, so it must be constant across hits - a per-hit score in
 * it would give every song its own one-row group.
 */
const SEMANTIC_INTENT_PREFIX = 'Lyric Semantic Match';

/** Label for the fulltext branch, constant for the same reason. */
const FULLTEXT_INTENT = 'Fulltext Match';

/** kNN candidates pulled from the semantic index per request. */
const SEMANTIC_CANDIDATES = 20;

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
  name: 'qobuz' | 'file' | 'spotify' | 'youtube';
  technical_info?: TechnicalInfo;
};

export type MusicSearchResult = {
  id: string;
  source: PlaySource[];
  title: string;
  artist: string;
  album: string;
};

const TechnicalInfoSchema = z.object({
  size: z.number().optional(),
  encoding: z.string().optional(),
  bitrate: z.number().optional(),
  sample_rate: z.number().optional(),
  is_high_res: z.boolean().optional(),
  is_cd_quality: z.boolean().optional(),
  duration: z.number().optional(),
  bit_depth: z.number().optional(),
  extension: z.string().optional(),
  bpm: z.number().optional(),
});

const PlaySourceSchema = z.object({
  sourceId: z.string(),
  name: z.enum(['file', 'spotify', 'qobuz', 'youtube'], {
    message: 'source name is not valid',
  }),
  technical_info: TechnicalInfoSchema.optional(),
});

/**
 * Validates an already-flattened {@link MusicSearchResult}, i.e. what
 * {@link PopulatedSongToMusicSearchResultSchema} *produced* and what is stored
 * in Redis — `artist` and `album` are plain strings here, not populated refs.
 *
 * Use this on cache reads. Feeding a cached playlist back through
 * `PopulatedSongToMusicSearchResultSchema` always fails, because that schema
 * expects `artist: { artist: string }` / `album: { title: string }`.
 *
 * Sources are re-filtered on the way out so a playlist cached before a source went
 * inactive cannot hand an unplayable entry to the MPD handler.
 */
export const MusicSearchResultSchema = z.object({
  id: z.string(),
  source: z.array(PlaySourceSchema).transform((sources) => filterActiveSources(sources)),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
});

/** Cache-read schema for a whole playlist. See {@link MusicSearchResultSchema}. */
export const MusicSearchResultsSchema: z.ZodType<MusicSearchResult[]> = z.array(MusicSearchResultSchema);

/**
 * Turns a `PopulatedSong` straight out of Mongo into the flattened shape cached in Redis.
 * This is where an inactive source leaves the pipeline: whatever is dropped here never
 * reaches the cache, and therefore never reaches MPD.
 */
export const PopulatedSongToMusicSearchResultSchema = z.object({
  // A hydrated document exposes `id` as a string; a raw aggregate row carries the ObjectId.
  id: z.union([z.string(), z.instanceof(Types.ObjectId).transform((id) => id.toHexString())]),
  source: z
    .array(
      z
        .object({
          sourceId: z.string().optional().default(''),
          name: z.enum(['file', 'spotify', 'qobuz', 'youtube'], {
            message: 'source name is not valid',
          }),
        })
        .passthrough(),
    )
    .transform((sources) =>
      filterActiveSources(sources).map((source) => ({
        sourceId: source.sourceId || '',
        name: source.name,
      })),
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
    record.source.every((src: unknown) => {
      if (typeof src !== 'object' || src === null) return false;
      const candidate = src as Record<string, unknown>;
      return (
        typeof candidate.sourceId === 'string' &&
        (candidate.name === 'qobuz' || candidate.name === 'file' || candidate.name === 'spotify' || candidate.name === 'youtube')
      );
    }) &&
    typeof record.title === 'string' &&
    typeof record.artist === 'string' &&
    typeof record.album === 'string'
  );
}

export class DiscJockeyAgent extends Agent {
  name = 'MusicSearchAgent';
  protected readonly logger = new Logger(this.name);
  /**
   * The cached file is the database profile (data); the prompt is the cache's system instruction.
   * `GenerateQueryWithCacheRequest` is the only request that references this cache, so nothing
   * else inherits the instruction — and because CacheHandler reuses a cache by name without
   * comparing content, editing the prompt does nothing until `promptus clear-cache`.
   */
  protected cache: ReadonlyAgentCache = {
    name: 'dj-nounoune-cache',
    file: `files/dj-nounoune-cache`,
    fileMineType: 'text/plain',
    model: GEMINI_FLASH,
    cacheInstruction: generateQueryWithCache,
    cacheContent: undefined,
  };

  constructor(
    apiKey: string,
    toolService: ToolsService,
    protected profilerService: ProfilerService,
    protected fileService: FileService,
    protected musicDBService: MusicDbService,
    protected opensearchService: OpensearchService,
    protected redisCacheService: RedisCacheService,
    protected eventEmitter: EventEmitter2,
  ) {
    super();
    this.initialiseAgent(apiKey, toolService, eventEmitter);
  }

  /**
   * The query generator on its own: make sure the DB-profile cache is live, then turn the request
   * into its three branches. `createPlaylist` builds on this; `opensearch semantic` calls it directly
   * to show what the model produced before anything is searched.
   */
  async generateQuery(naturalLanguageRequest: string, sessionId?: string): Promise<GenerateQueryWithCacheResponse> {
    if (!this.cache.cacheContent || new Date(this.cache.cacheContent?.expireTime || 0).getTime() < new Date().getTime()) {
      const dbProfile = await this.profilerService.getDatabaseProfileForPrompt();
      await this.fileService.saveFile(this.cache.name, dbProfile);

      const cacheContent = await this.cacheHandler.cache(this.cache);
      if (!cacheContent || !cacheContent.expireTime) {
        const error = 'Cache Creation failed. Please check cache content and cache name.';
        if (sessionId) {
          this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent(error, sessionId));
        }
        throw new Error(error);
      }
      this.cache.cacheContent = cacheContent;
    }

    const request = new GenerateQueryWithCacheRequest(naturalLanguageRequest, this.cache.cacheContent);
    return await this.generate(request, sessionId);
  }

  /**
   * [Nest] 59588  - 07/01/2026, 7:28:22 PM   ERROR [PromptusService] ApiError: {"error":{"code":403,"message":"CachedContent not found (or permission denied)","status":"PERMISSION_DENIED"}}
   *     at throwErrorIfNotOK (C:\Users\Alexandre\WebstormProjects\dj-nounoune\node_modules\@google\genai\dist\node\index.cjs:12224:30)
   *     at processTicksAndRejections (node:internal/process/task_queues:105:5)
   * @param naturalLanguageRequest
   * @param sessionId
   */
  async createPlaylist(naturalLanguageRequest: string, sessionId?: string): Promise<RedisCacheKey> {
    if (!sessionId) {
      throw new Error('sessionId is required to createPlaylist');
    }

    const generateQueryWithCacheResponse = await this.generateQuery(naturalLanguageRequest, sessionId);

    this.logger.log(JSON.stringify(generateQueryWithCacheResponse.aggregate, null, 2));
    this.logger.log(JSON.stringify(generateQueryWithCacheResponse.fulltext, null, 2));

    // Each definition is sampled on its own, so the same song can come back from several
    // intents — the map collapses them while keeping the first populated copy.
    const musicResult = new Map<string, { intent: string; song: PopulatedSong }>();
    const groupedResults = await this.musicDBService.findByMongoWrapper(generateQueryWithCacheResponse.aggregate, 50);
    for (const group of groupedResults) {
      this.logger.log(`${group.intent}: ${group.items.length} songs`);
      group.items.forEach((song) => musicResult.set(song.id.toString(), { intent: group.intent, song }));
    }

    if (generateQueryWithCacheResponse.fulltext.length > 0) {
      const fullTextResult = await this.opensearchService.fuzzySearch(generateQueryWithCacheResponse.fulltext, 50);
      if (fullTextResult && fullTextResult.hits.hits.length > 0) {
        for (const hit of fullTextResult.hits.hits) {
          if (hit._score > 0.5 && !musicResult.has(hit._id.toString())) {
            // Mongo is the authority on source availability: the OpenSearch filter is only a
            // pre-filter, and it deliberately lets through documents indexed without a `source`.
            const fullTextSong = await this.musicDBService.getPopulatedSongsByIds([hit._id.toString()], true);
            if (fullTextSong.length === 0) {
              continue;
            }
            this.logger.debug(`fulltext hit ${hit._id} score=${hit._score}`);
            musicResult.set(hit._id.toString(), { intent: FULLTEXT_INTENT, song: fullTextSong[0] });
          }
        }
      }
    }

    // The third branch: what the library holds that is *about* the same thing. No score floor to
    // start with - `k` already bounds the result and kNN cosine scores are not on the BM25 scale the
    // fulltext threshold above was tuned against. Scores are logged so a floor can be set later.
    if (generateQueryWithCacheResponse.semantic) {
      this.logger.log(`semantic: ${generateQueryWithCacheResponse.semantic}`);
      const semanticResult = await this.opensearchService.searchBySemantic(generateQueryWithCacheResponse.semantic, SEMANTIC_CANDIDATES);
      if (semanticResult) {
        // The sentence itself goes to the curator as the section header, not in the intent.
        const intent = SEMANTIC_INTENT_PREFIX;
        const newIds: string[] = [];
        for (const hit of semanticResult.hits.hits) {
          this.logger.debug(`semantic hit ${hit._id} score=${hit._score}`);
          if (!musicResult.has(hit._id.toString())) {
            newIds.push(hit._id.toString());
          }
        }

        // One round trip for the whole branch, with Mongo as the authority on source availability.
        const semanticSongs = newIds.length > 0 ? await this.musicDBService.getPopulatedSongsByIds(newIds, true) : [];
        for (const song of semanticSongs) {
          musicResult.set(song.id.toString(), { intent, song });
        }
        this.logger.log(`${SEMANTIC_INTENT_PREFIX}: ${semanticSongs.length} songs`);
      }
    }

    if (musicResult.size == 0) {
      this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent('No Songs Found', sessionId));
      throw new Error('No songs found');
    }

    const postFiltering = await this.postFilteringSong(naturalLanguageRequest, musicResult, generateQueryWithCacheResponse.semantic);
    const arrangePopulatedSongs = await this.findBestArrangement(naturalLanguageRequest, postFiltering);

    const playlistItemMsg = arrangePopulatedSongs
      .map((item, index) => `${index + 1} - [${item.artist.artist}] ${item.album.title} - ${item.title}`)
      .join('\n');
    this.eventEmitter.emit(ChatStatusResponseEventName, new ChatStatusResponseEvent(playlistItemMsg, sessionId));

    // todo remove the extra cast since it is not required after the use of cache.
    const cachedResult = z.array(PopulatedSongToMusicSearchResultSchema).parse(arrangePopulatedSongs);
    const cacheKey = sessionId + ':playlist' + new Date().getTime();
    await this.redisCacheService.set(cacheKey, cachedResult);
    return cacheKey;
  }

  private async findBestArrangement(naturalLanguageRequest: string, populatedSongs: PopulatedSong[]): Promise<PopulatedSong[]> {
    const arrangedSongs: PopulatedSong[] = [];
    const aiRequestMap = new Map<number, string>();
    // Generate the map for efficient token usage
    // `+=`, not `=`: the query used to be overwritten by the header, so the arrangement model never
    // saw the request it was ordering for.
    let prompt = `# Query \n${naturalLanguageRequest} \n`;
    prompt += `# PSV\nid|artist|album|title|emotion|pace|track_number|language|country|lyric_semantic\n`;
    populatedSongs.forEach((song, index) => {
      aiRequestMap.set(index + 1, song.id.toString());
      prompt += `${index + 1}|${song.artist.artist}|${song.album.title}|${song.title}|${song.emotion}|${song.pace}|${song.track_number}|${song.language}|${song.country}|${song.lyric_semantic ?? ''}\n`;
    });

    const response = await this.generate(new FindBestArrangementRequest(prompt));

    response.items.forEach((item) => {
      const id = aiRequestMap.get(Number(item));
      if (id) {
        const song = populatedSongs.find((song) => song.id.toString() === id);
        if (song) {
          arrangedSongs.push(song);
        }
      }
    });

    return arrangedSongs;
  }

  /**
   * The candidates reach the curator as two sections, because they are two kinds of evidence.
   * `# Songs` is the category pool - what the tag and fulltext branches returned - grouped by the
   * intent that produced each group, with tags. `# Semantic Songs` is the lyric pool - what the
   * index returned for `semanticQuery` - shown with the sentence each song was matched on and
   * nothing else, so the model judges it on meaning rather than on tags it was never selected by.
   * Ids run in one sequence across both.
   */
  async postFilteringSong(request: string, candidates: Map<string, { intent: string; song: PopulatedSong }>, semanticQuery?: string) {
    const recentlyPlayed = await this.musicDBService.getRecentlyPlayedArtist();

    const categoryHeader = 'ID|Artist|Album|Title|emotion|pace|genre|track_number|language';
    const semanticHeader = 'ID|Artist|Album|Title|lyric_semantic';

    const intents: Record<string, string> = {};
    const semanticRows: string[] = [];
    const idRemap = new Map<string, string>();
    let inc = 0;
    for (const curr of candidates.values()) {
      inc++;
      idRemap.set(inc.toString(), curr.song.id.toString());
      const song = curr.song;

      if (curr.intent.startsWith(SEMANTIC_INTENT_PREFIX)) {
        semanticRows.push(`${inc}|${song.artist.artist}|${song.album.title}|${song.title}|${song.lyric_semantic ?? ''}`);
        continue;
      }

      const psvline = `${inc}|${song.artist.artist}|${song.album.title}|${song.title}|${song.emotion}|${song.pace}|${song.genre}|${song.track_number}|${song.language}`;
      intents[curr.intent] = (intents[curr.intent] ?? `${categoryHeader}\n`) + `${psvline}\n`;
    }

    const categorySection =
      Object.keys(intents).length > 0
        ? Object.entries(intents)
            .map(([intent, rows]) => `### ${intent}\n${rows}`)
            .join('\n')
        : '(none)\n';

    // Only rendered when the branch produced something: an empty section would invite the model
    // to reason about a pool that does not exist.
    const semanticSection =
      semanticRows.length > 0 ? `\n# Semantic Songs\nMatched on: "${semanticQuery ?? ''}"\n${semanticHeader}\n${semanticRows.join('\n')}\n` : '';

    const reactionSection = await this.buildReactionSection(candidates, idRemap);

    const prompt = `
# User Request:
${request}

# Recently Played Artists
Artist|Last Played
${recentlyPlayed.map((artist) => artist.artist + '|' + artist.playedAt).join('\n')}

# Songs
${categorySection}${semanticSection}${reactionSection}`;

    const response = await this.generate(new PostFilteringRequest(prompt));

    const result: PopulatedSong[] = [];

    for (const filteredCandidate of response.items) {
      const id = idRemap.get(filteredCandidate) || '';
      const song = candidates.get(id);
      if (song) {
        result.push(song.song);
      }
    }

    return result;
  }

  /**
   * The `# Reactions` section of the post-filtering prompt: every candidate the listeners have ever
   * reacted to, on the same remapped ids as the catalogue, best received first. Songs with no
   * reaction at all are left out rather than shown as zeros - a row of zeros reads as a verdict,
   * and the prompt tells the model that absence is neither.
   *
   * `score` is the net verdict the rows are sorted by: awesome and wtf weigh double because they
   * are the emphatic buttons. The weights are stated in the prompt; keep the two in step.
   */
  private async buildReactionSection(
    candidates: Map<string, { intent: string; song: PopulatedSong }>,
    idRemap: Map<string, string>,
  ): Promise<string> {
    const reactions = await this.musicDBService.getSongReactions([...candidates.keys()]);
    if (reactions.size === 0) return '';

    const rows = [...idRemap.entries()].flatMap(([promptId, songId]) => {
      const reaction = reactions.get(songId);
      const song = candidates.get(songId)?.song;
      if (!reaction || !song) return [];
      const score = reaction.awesome * 2 + reaction.great - reaction.duh - reaction.wtf * 2;
      return [{ promptId, song, reaction, score }];
    });

    rows.sort((a, b) => b.score - a.score || b.reaction.awesome - a.reaction.awesome || b.reaction.plays - a.reaction.plays);

    const header = 'ID|Artist|Title|plays|awesome|great|duh|wtf|score';
    const lines = rows.map(
      ({ promptId, song, reaction, score }) =>
        `${promptId}|${song.artist.artist}|${song.title}|${reaction.plays}|${reaction.awesome}|${reaction.great}|${reaction.duh}|${reaction.wtf}|${score}`,
    );

    return `\n# Reactions\n${header}\n${lines.join('\n')}\n`;
  }

  async whatIsPlaying(request: string, sessionId?: string, options?: { withoutCurrentSongTool?: boolean }) {
    const wip = new WhatIsPlayingRequest(request, options);
    return await this.generate(wip, sessionId);
  }

  /**
   * Upcoming concerts, festival slots and tour dates for an artist, resolved through a grounded web
   * search. Nothing in the library can answer this: the dates only exist on the open web, and they
   * change week to week.
   */
  async findUpcomingPerformances(request: string, sessionId?: string) {
    const performanceRequest = new ArtistPerformanceRequest(request);
    return await this.generate(performanceRequest, sessionId);
  }

  /**
   * General music conversation, about records the household does not own as much as the ones it does.
   * Grounded, so anything recent is checked rather than recalled, and deliberately kept away from the
   * database tools — this one talks, it does not queue.
   */
  async talkAboutMusic(request: string, sessionId?: string) {
    const talkRequest = new MusicTalkRequest(request);
    return await this.generate(talkRequest, sessionId);
  }

  /**
   * Resolve the artwork for a release through a grounded web search. Called directly on a song change,
   * so it is not exposed as a tool. Returns null rather than throwing when nothing is found.
   */
  async findAlbumCover(artist: string, album: string, sessionId?: string): Promise<string | null> {
    const coverRequest = new AlbumCoverRequest(artist, album);
    const response = await this.generate(coverRequest, sessionId);
    return response.imageUrl;
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

    if (request instanceof AlbumCoverRequest) {
      return new AlbumCoverResponse(response) as ReqType;
    }

    if (request instanceof ArtistPerformanceRequest) {
      return new ArtistPerformanceResponse(response) as ReqType;
    }

    if (request instanceof MusicTalkRequest) {
      return new MusicTalkResponse(response) as ReqType;
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }
}
