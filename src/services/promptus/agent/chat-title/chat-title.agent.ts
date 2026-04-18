// import { filter, from, Subject, mergeMap, map, catchError, EMPTY } from 'rxjs';
// import { Agent } from '../../agent';
// import { ToolsService } from '../../tools.service';
// import { Logger } from '@nestjs/common';
// import { PromptusRequest } from '../../promptus.request';
// import { GenerateContentResponse } from '@google/genai';
// import { ChatTitleResponse } from './chat-title.response';
// import { ChatTitleRequest } from './chat-title.request';
// import { ChatService } from '../../../chat/chat.service';
// import { EventEmitter2 } from '@nestjs/event-emitter';
//
//
// export class ChatTitleAgent extends Agent {
//   private handler = new Subject<ChatTitleContext>();
//   name = 'ChatTileAgent';
//   protected readonly logger = new Logger(this.name);
//
//   constructor(
//     apiKey: string,
//     protected toolService: ToolsService,
//     protected eventEmitter: EventEmitter2,
//     private chatService: ChatService,
//   ) {
//     super();
//   //   this.initialiseAgent(apiKey, toolService, eventEmitter);
//   //   this.handler
//   //     .pipe(
//   //       mergeMap((context) =>
//   //         from(this.generate(context.request)).pipe(
//   //           filter((response) => !!response && !!response.text),
//   //           mergeMap((response) =>
//   //             from(this.chatService.update(context.chatId, { topic: response.text })).pipe(
//   //               map((chatObj) => {
//   //                 context.subject.next({
//   //                   chatId: context.chatId,
//   //                   message: chatObj.topic,
//   //                   type: 'chat_title_refreshed',
//   //                 });
//   //               }),
//   //             ),
//   //           ),
//   //           catchError((error) => {
//   //             console.error(`Failed to update title for chat ${context.chatId}:`, error);
//   //             return EMPTY;
//   //           }),
//   //         ),
//   //       ),
//   //     )
//   //     .subscribe();
//   // }
//   //
//   // protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
//   //   if (request instanceof ChatTitleRequest) {
//   //     return new ChatTitleResponse(response) as ReqType;
//   //   }
//   //
//   //   throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
//   // }
//   //
//   // // 5. This method is now stateless and completely thread-safe
//   // updateChatTopic(chatId: string, message: string, chatStatusSubject: Subject<ChatStatusMessage>) {
//   //   this.handler.next({
//   //     chatId,
//   //     request: new ChatTitleRequest(message),
//   //     subject: chatStatusSubject,
//   //   });
//   // }
// }
