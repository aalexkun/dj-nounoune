import { Injectable, Logger } from '@nestjs/common';
import { Agent } from './agent';

import { CacheHandler } from './handler/cache.handler';
import { Subject } from 'rxjs';
import { ChatPromptusRequest } from './request/chat.promptus.request';
import { AppService } from '../../app.service';
import { ToolsService } from './tools.service';
import { ChatService } from '../chat/chat.service';
import { GenerateContentResponse } from '@google/genai';
import { PromptusRequest } from './promptus.request';
import * as chatGatewayTypes from '../../gateway/chat.gateway.types';
import { ChatPromptusResponse } from './response/chat.promptus.response';

@Injectable()
export class PromptusService extends Agent {
  protected readonly logger = new Logger('PromptusService');
  public readonly cacheHandler: CacheHandler;

  constructor(
    appService: AppService,
    protected toolService: ToolsService,
    private chatService: ChatService,
  ) {
    super();

    this.initialiseAgent(appService.getGenAiApiKey(), this.toolService);
    this.toolService.initialiseAgent(appService.getGenAiApiKey());
    this.cacheHandler = new CacheHandler(this.client);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof ChatPromptusRequest) {
      return new ChatPromptusResponse(response) as ReqType;
    }
    throw new Error('Method not implemented. PromptusService::wrapResponse ');
  }

  public async chat(payload: chatGatewayTypes.ChatMessage, statusSubject: Subject<chatGatewayTypes.ChatStatusMessage>): Promise<string> {
    let aiResponse = '';

    const history = await this.chatService.getHistory(payload.chatId);
    const request = new ChatPromptusRequest(payload.message, history);

    const messageUpdateCallBack = (message: string) => {
      statusSubject.next({
        chatId: payload.chatId,
        message: message,
        type: 'process_update',
      });
    };

    // Rename the chat with the first prompt.
    if (history.length == 0) {
      this.toolService
        .proceedFunctionCall({
          name: 'update_chat_title',
          args: {
            chatId: payload.chatId,
            title: payload.message,
            statusSubject: statusSubject,
          },
        })
        .then(() => {
          this.logger.log('Chat title updated');
        })
        .catch((e) => {
          this.logger.error('Chat title update failed' + JSON.stringify(e));
        });
    }

    const response = await this.generate(request, messageUpdateCallBack);

    if (response.content) {
      request.addHistory(response.content);
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

    await this.chatService.saveHistory(payload.chatId, request.history);

    statusSubject.next({
      chatId: payload.chatId,
      message: aiResponse,
      type: 'process_update',
    });

    return aiResponse;
  }
}
