import { GenerateContentResponse, GoogleGenAI, CachedContent, createUserContent, createPartFromUri } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { AppService } from '../../../app.service';

import { SearchPromptusRequest } from './request/search.promptus.request';
import { EnrichPromptusRequest } from './request/enrich-promptus.request';
import { SearchPromptusResponse } from './response/search.promptus.response';
import { EnrichPromptusResponse } from './response/enrich.promptus.response';
import { PromptusRequest } from './request/promptus.request';
import { GetSourceIdPromptusRequest } from './request/get-source-id.promptus.request';
import { GetSourceIdPromptusResponse } from './response/get-source-id.promptus.response';
import { CacheHandler } from './handler/cache.handler';
import { ThrottleHandler } from './handler/throttle.handler';
import { MpdClientService } from '../../mpd-client/mpd-client.service';
import { MusicDbService } from '../../music-db/music-db.service';
import { ClearMpdRequest } from '../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../mpd-client/requests/AddMpdRequest';
import { PlayMpdRequest } from '../../mpd-client/requests/PlayMpdRequest';
import { JSONPath } from 'jsonpath-plus';

@Injectable()
export class PromptusService {
  private apiKey: string;
  private readonly client: GoogleGenAI;
  private readonly logger = new Logger('PromptusService');

  public readonly cacheHandler: CacheHandler;

  private throttleHandler: ThrottleHandler;

  constructor(
    appService: AppService,
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
  ) {
    this.apiKey = appService.getGenAiApiKey();
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    this.cacheHandler = new CacheHandler(this.client);
    this.throttleHandler = new ThrottleHandler(this.client);
  }

  async parallelGenerate<ReqType>(requests: PromptusRequest<ReqType>[], concurrencyLimit: number = 1): Promise<ReqType[]> {
    this.logger.log(`Starting parallel generation for ${requests.length} requests (Concurrency Limit: ${concurrencyLimit})...`);

    const results: ReqType[] = new Array(requests.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < requests.length) {
        try {
          const index = currentIndex++;
          const request = requests[index];
          await this.throttleHandler.acquireTokens(request);
          results[index] = await this.generate(request);
          this.logger.log(`Completed request ${index + 1}/${requests.length}`);
        } catch (e) {
          this.logger.error(e);
        }
      }
    };

    const workers: Promise<void>[] = [];
    const actualConcurrency = Math.min(concurrencyLimit, requests.length);

    for (let i = 0; i < actualConcurrency; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    this.logger.log('Parallel generation completed.');
    return results;
  }

  async generate<ReqType>(request: PromptusRequest<ReqType>): Promise<ReqType> {
    this.logger.log(`Starting: Request ${request.constructor.name}`);

    const aiRequest = await request.getGeneratedContent();
    const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);

    this.logger.log(`End: Request ${request.constructor.name}`);
    return this.wrapResponse(request, response);
  }

  private wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof SearchPromptusRequest) {
      return new SearchPromptusResponse(response) as ReqType;
    }

    if (request instanceof EnrichPromptusRequest) {
      return new EnrichPromptusResponse(response) as ReqType;
    }

    if (request instanceof GetSourceIdPromptusRequest) {
      return new GetSourceIdPromptusResponse(response) as ReqType;
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }

  private parseResponse(response: GenerateContentResponse): string {
    // response.candidates[0].finishMessage === 'MAX_TOKENS'
    return response.text || '';
  }

  public async play(query: string): Promise<string[]> {
    const response = await this.generate(new SearchPromptusRequest(query));

    if (!Array.isArray(response) && response?.parsed?.function === 'aggregate') {
      this.logger.debug(JSON.stringify(response.parsed, null, 2));
      const result = await this.musicDbService.aggregate(response.parsed.collection, response.parsed.params);

      if (result.length > 0) {
        const jsonPathMapping = await this.generate(new GetSourceIdPromptusRequest(JSON.stringify(result[0])));

        if (jsonPathMapping.mapping.sourceId) {
          this.logger.log('Clearing the Queue');
          await this.mpdClientService.send(new ClearMpdRequest());

          const jsonPAth = jsonPathMapping.mapping.sourceId;
          const songsAdd: string[] = [];
          await Promise.all(
            result.map(async (song) => {
              try {
                const sourceId = JSONPath({ path: jsonPAth, json: song });
                const playId = Array.isArray(sourceId) ? sourceId[0] : sourceId;
                const result = await this.mpdClientService.send(new AddMpdRequest(playId));
                songsAdd.push(sourceId);
                this.logger.debug(`Response: ${result.rawResponse.trim()}`);
              } catch (error: any) {
                this.logger.error(`Failed to add to playlist: ${error.message}`);
              }
            }),
          );

          this.logger.log('Playlist is Generated');

          try {
            const playResult = await this.mpdClientService.send(new PlayMpdRequest());
            this.logger.log('Playback started.');
            this.logger.debug(playResult.rawResponse);
            return songsAdd;
          } catch (error: any) {
            this.logger.error(`Failed to play: ${error.message}`);
          }
        } else {
          this.logger.warn('No files found for query: ' + query);
        }
      } else {
        this.logger.warn('No results found for query: ' + query);
        this.logger.debug(JSON.stringify(response?.parsed, null, 2));
      }
    } else {
      this.logger.error(JSON.stringify(response, null, 2));
      throw new Error('Unsupported response type');
    }

    return [];
  }
}
