// import { FunctionCallResult, ToolHandler } from '../../tool.type';
// import { Subject } from 'rxjs';
// import { Logger } from '@nestjs/common';
// import { ChatStatusMessage } from '../../../../../gateway/chat.gateway.types';
// import { ChatTitleAgent } from '../../../agent/chat-title/chat-title.agent';
//
// type ChatTitleHandlerArgs = {
//   chatId: string;
//   title: string;
//   statusSubject: Subject<ChatStatusMessage>;
// };
//
// export class ChatTitleHandler implements ToolHandler {
//   readonly name = 'update_chat_title';
//   private readonly logger = new Logger('ChatTitleHandler');
//
//   constructor(private readonly chatAgent: ChatTitleAgent) {}
//
//   async execute(args: unknown): Promise<FunctionCallResult> {
//     if (!this.isChatTitleHandlerArgs(args)) {
//       const err = `Invalid arguments provided to ${this.name}. Expected an object with ChatTitleHandlerArgs property.`;
//       this.logger.error(err);
//       return {
//         message: err,
//         name: this.name,
//         type: 'string',
//       };
//     }
//
//     this.chatAgent.updateChatTopic(args.chatId, args.title, args.statusSubject);
//     return {
//       message: `Chat title update initiated to: ${args.title}`,
//       name: this.name,
//       type: 'string',
//     };
//   }
//
//   private isChatTitleHandlerArgs(args: unknown): args is ChatTitleHandlerArgs {
//     if (!args || typeof args !== 'object') {
//       return false;
//     }
//
//     const obj = args as Record<string, unknown>;
//
//     return typeof obj.chatId === 'string' && typeof obj.title === 'string' && obj.statusSubject instanceof Subject;
//   }
// }
