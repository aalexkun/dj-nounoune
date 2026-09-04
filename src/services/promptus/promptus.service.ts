import { Injectable, Logger } from '@nestjs/common';
import { Agent } from './agent';

import { ChatPromptusRequest } from './request/chat.promptus.request';
import { AppService } from '../../app.service';
import { ToolsService } from './tools.service';
import { GenerateContentResponse } from '@google/genai';
import { PromptusRequest } from './promptus.request';
import { ChatPromptusResponse } from './response/chat.promptus.response';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { ThrottleHandler } from './handler/throttle.handler';

@Injectable()
export class PromptusService extends Agent {
  readonly name = 'Promptus';
  protected readonly logger = new Logger('PromptusService');


  constructor(
    appService: AppService,
    protected toolService: ToolsService,
    protected eventEmitter: EventEmitter2,
    redisCacheService: RedisCacheService,
  ) {
    super();

    // Process-wide: the daily request count is shared by every agent and, through Redis, by every
    // process on this API key. Wired here because this is the first agent to come up.
    ThrottleHandler.useDailyCounter(redisCacheService);

    this.initialiseAgent(appService.getGenAiApiKey(), this.toolService, this.eventEmitter);
    this.toolService.initialiseAgent(appService.getGenAiApiKey(), this.eventEmitter);

  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof ChatPromptusRequest) {
      return new ChatPromptusResponse(response) as ReqType;
    }

    throw new Error('Method not implemented. PromptusService::wrapResponse ');
  }
}
