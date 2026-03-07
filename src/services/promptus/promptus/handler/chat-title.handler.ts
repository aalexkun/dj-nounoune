import { filter, from, Subject, mergeMap, map, catchError, EMPTY } from 'rxjs';
import { PromptusService } from '../promptus.service';
import { ChatTitlePromptusRequest } from '../request/chat-title.promptus.request';
import { ChatService } from '../../../chat/chat.service';
import { ChatStatusMessage } from '../../../../gateway/chat.gateway.types';

interface ChatTitleContext {
  chatId: string;
  request: ChatTitlePromptusRequest;
  subject: Subject<ChatStatusMessage>;
}

export class ChatTitleHandler {
  private handler = new Subject<ChatTitleContext>();

  constructor(
    private promptus: PromptusService,
    private chatService: ChatService,
  ) {
    this.handler
      .pipe(
        mergeMap((context) =>
          from(this.promptus.generate(context.request)).pipe(
            filter((response) => !!response && !!response.text),
            mergeMap((response) =>
              from(this.chatService.update(context.chatId, { topic: response.text })).pipe(map((chatObj) => ({ chatObj, context }))),
            ),
            catchError((error) => {
              console.error(`Failed to update title for chat ${context.chatId}:`, error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe(({ chatObj, context }) => {
        // 4. We emit directly to the specific Subject passed in the original request
        context.subject.next({
          chatId: context.chatId,
          message: chatObj.topic,
          type: 'chat_title_refreshed',
        });
      });
  }

  // 5. This method is now stateless and completely thread-safe
  updateChatTopic(chatId: string, message: string, chatStatusSubject: Subject<ChatStatusMessage>) {
    this.handler.next({
      chatId,
      request: new ChatTitlePromptusRequest(message),
      subject: chatStatusSubject,
    });
  }
}
