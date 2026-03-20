import { GenerateContentResponse, GoogleGenAI, CountTokensParameters, FunctionCall, FinishReason } from '@google/genai';
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
import { Subject } from 'rxjs';
import { ChatPromptusRequest } from './request/chat.promptus.request';
import { ChatPromptusResponse } from './response/chat.promptus.response';
import { StopMpdRequest } from '../../mpd-client/requests/StopMpdRequest';
import { CurrentSongMpdRequest } from '../../mpd-client/requests/CurrentSongMpdRequest';
import { PlaylistMpdRequest } from '../../mpd-client/requests/PlaylistMpdRequest';
import { ChatService } from '../../chat/chat.service';
import { ChatTitlePromptusRequest } from './request/chat-title.promptus.request';
import * as chatGatewayTypes from '../../../gateway/chat.gateway.types';
import { ChatTitleHandler } from './handler/chat-title.handler';
import { MusicSearchHandler, MusicSearchResult } from './handler/music-search.handler';

@Injectable()
export class PromptusService {
  private maxThinkingLoop = 10;
  private apiKey: string;
  private readonly client: GoogleGenAI;
  private readonly logger = new Logger('PromptusService');

  public readonly cacheHandler: CacheHandler;

  private throttleHandler: ThrottleHandler;
  private chatTitleHandler: ChatTitleHandler;
  private musicSearchHandler: MusicSearchHandler;

  constructor(
    appService: AppService,
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
    private chatService: ChatService,
  ) {
    this.apiKey = appService.getGenAiApiKey();
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    this.cacheHandler = new CacheHandler(this.client);
    this.throttleHandler = new ThrottleHandler(this.client);
    this.chatTitleHandler = new ChatTitleHandler(this, this.chatService);
    this.musicSearchHandler = new MusicSearchHandler(this, this.musicDbService);
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

    const tokenCount = await this.client.models.countTokens({
      model: request.model,
      contents: aiRequest.contents,
    });
    this.logger.debug(`Token Count: ${tokenCount.totalTokens} (Model: ${request.model})`);

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

    if (request instanceof ChatPromptusRequest) {
      return new ChatPromptusResponse(response) as ReqType;
    }

    if (request instanceof ChatTitlePromptusRequest) {
      return new ChatPromptusResponse(response) as ReqType;
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }

  public async chat(payload: chatGatewayTypes.ChatMessage, statusSubject: Subject<chatGatewayTypes.ChatStatusMessage>): Promise<string> {
    let loop = 0;
    let aiResponse = '';

    const history = await this.chatService.getHistory(payload.chatId);
    const request = new ChatPromptusRequest(payload.message, history);

    // Rename the chat with the first prompt.
    if (history.length == 0) {
      this.chatTitleHandler.updateChatTopic(payload.chatId, payload.message, statusSubject);
    }

    while (loop < this.maxThinkingLoop) {
      const response = await this.generate(request);

      if (response.content) {
        request.pushAiResponse(response.content);
      }

      if (response.functionCall) {
        for (const fc of response.functionCall) {
          let result = await this.proceedFunctionCall(fc);
          if (result) {
            request.pushFunctionResponse(result, fc);
            statusSubject.next({
              chatId: payload.chatId,
              message: result,
              type: 'process_update',
            });
          }
        }
      } else {
        if (response.finishReason === FinishReason.STOP) {
          loop = Number.MAX_SAFE_INTEGER;
        } else {
          loop++;
        }
        if (response.text) {
          aiResponse = response.text;
        } else {
          this.logger.warn('No text found in response');
          statusSubject.next({
            chatId: payload.chatId,
            message: 'No text found in response',
            type: 'process_update',
          });
        }
      }
    }

    await this.chatService.saveHistory(payload.chatId, request.history);

    return aiResponse;
  }

  private async proceedFunctionCall(fc: FunctionCall) {
    if (
      fc.name === 'play_music' &&
      fc.args &&
      'songs' in fc.args &&
      Array.isArray(fc.args.songs) &&
      fc.args.songs.every((song: any) => song && typeof song === 'object' && typeof song.sourceId === 'string')
    ) {
      const result = await this.play(fc.args.songs);
      const markdownList = result.map((item) => `- ${item}`).join('\n');
      return `Songs queued successfully:\n\n${markdownList}`;
    } else if (fc.name === 'stop_playback') {
      const response = await this.mpdClientService.send(new StopMpdRequest());
      return 'Playback stopped.';
    } else if (fc.name === 'current_song') {
      const result = await this.mpdClientService.send(new CurrentSongMpdRequest());
      return JSON.stringify(result.song) || 'No song is currently playing.';
    } else if (fc.name === 'current_playlist') {
      const result = await this.mpdClientService.send(new PlaylistMpdRequest());
      return JSON.stringify(result.tracks) || 'No playlist is currently playing.';
    } else if (
      fc.name === 'query_music_database' &&
      fc.args &&
      'natural_language_request' in fc.args &&
      typeof fc.args.natural_language_request === 'string'
    ) {
      const musicSearchResult = await this.musicSearchHandler.search(fc.args.natural_language_request);
      return JSON.stringify({
        functionResponses: [
          {
            name: 'query_music_database',
            response: {
              results: musicSearchResult,
            },
          },
        ],
      });
    } else if (fc.name === 'genre_distribution') {
      return JSON.stringify(await this.musicDbService.getGenreDistribution());
    } else if (fc.name === 'artist_distribution') {
      return JSON.stringify(await this.musicDbService.getArtistDistribution());
    } else if (fc.name === 'bpm_distribution') {
      return JSON.stringify(await this.musicDbService.getBPMDistribution());
    }

    throw new Error(`Unsupported function call: ${fc.name}`);
  }

  public async play(songs: Partial<MusicSearchResult>[]): Promise<string[]> {
    let songsQueued: string[] = [];
    if (songs?.length > 0) {
      this.logger.log('Generating new Playlist');

      try {
        await this.mpdClientService.send(new ClearMpdRequest());
      } catch (e) {
        this.logger.error(e);
        this.logger.error('Failed to clear MPD playlist');
      }

      for (const song of songs) {
        if (song.sourceId === undefined) {
          this.logger.error(`SourceId is undefined for song: ${JSON.stringify(song)}`);
          continue;
        }

        try {
          await this.mpdClientService.send(new AddMpdRequest(song.sourceId));
          songsQueued.push(`${song.artist} - ${song.album} - ${song.title}`);
        } catch (e) {
          this.logger.debug(`Could not added to playlist: ${song.title} - ${song.artist} - ${song.album} - ${song.sourceId}`);
        }
      }

      try {
        await this.mpdClientService.send(new PlayMpdRequest());
        this.logger.log('Playback started.');
      } catch (e) {
        this.logger.error(e);
        this.logger.error('Failed to start playback');
      }
    }

    return songsQueued;
  }
}
