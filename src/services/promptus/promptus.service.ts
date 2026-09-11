import { Injectable, Logger } from '@nestjs/common';
import { Agent } from './agent';

import { ChatPromptusRequest } from './request/chat.promptus.request';
import { ChatTitleRequest } from './request/chat-title.request';
import { ChatTitleResponse } from './response/chat-title.response';
import { AppService } from '../../app.service';
import { ToolsService } from './tools.service';
import { GenerateContentResponse } from '@google/genai';
import { PromptusRequest } from './promptus.request';
import { ChatPromptusResponse } from './response/chat.promptus.response';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { ThrottleHandler } from './handler/throttle.handler';
import { ChatStreamService } from '../chat/chat-stream.service';

@Injectable()
export class PromptusService extends Agent {
  readonly name = 'Promptus';
  protected readonly logger = new Logger('PromptusService');

  constructor(
    appService: AppService,
    protected toolService: ToolsService,
    protected eventEmitter: EventEmitter2,
    redisCacheService: RedisCacheService,
    chatStream: ChatStreamService,
  ) {
    super();

    // Process-wide: the daily request count is shared by every agent and, through Redis, by every
    // process on this API key. Wired here because this is the first agent to come up.
    ThrottleHandler.useDailyCounter(redisCacheService);

    this.initialiseAgent(appService.getGenAiApiKey(), this.toolService, this.eventEmitter, chatStream);
    this.toolService.initialiseAgent(appService.getGenAiApiKey(), this.eventEmitter, chatStream);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof ChatPromptusRequest) {
      return new ChatPromptusResponse(response) as ReqType;
    }

    // Hosted here rather than on an agent of its own because it has no tools to run and no loop to
    // drive: it is one structured call about a conversation this service is already holding.
    if (request instanceof ChatTitleRequest) {
      return new ChatTitleResponse(response) as ReqType;
    }

    throw new Error('Method not implemented. PromptusService::wrapResponse ');
  }
}
