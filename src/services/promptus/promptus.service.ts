import { Injectable, Logger } from '@nestjs/common';
import { Agent } from './agent';

import { CacheHandler } from './handler/cache.handler';
import { ChatPromptusRequest } from './request/chat.promptus.request';
import { AppService } from '../../app.service';
import { ToolsService } from './tools.service';
import { GenerateContentResponse } from '@google/genai';
import { PromptusRequest } from './promptus.request';
import { ChatPromptusResponse } from './response/chat.promptus.response';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PromptusService extends Agent {
  readonly name = 'Promptus';
  protected readonly logger = new Logger('PromptusService');
  public readonly cacheHandler: CacheHandler;

  constructor(
    appService: AppService,
    protected toolService: ToolsService,
    protected eventEmitter: EventEmitter2,
  ) {
    super();

    this.initialiseAgent(appService.getGenAiApiKey(), this.toolService, this.eventEmitter);
    this.toolService.initialiseAgent(appService.getGenAiApiKey(), this.eventEmitter);
    this.cacheHandler = new CacheHandler(this.client);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof ChatPromptusRequest) {
      return new ChatPromptusResponse(response) as ReqType;
    }
    throw new Error('Method not implemented. PromptusService::wrapResponse ');
  }
}
