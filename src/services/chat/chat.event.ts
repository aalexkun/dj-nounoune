export class ChatEvent {
  constructor(
    public readonly message: string,
    public readonly sessionId: string,
  ) {}
}

export const ChatMessageEventName = 'chat.message';
export class ChatMessageEvent extends ChatEvent {
  public readonly event = ChatMessageEventName;

  constructor(
    public readonly sessionId: string,
    public readonly message: string,
    public readonly chatId: string,
  ) {
    super(message, sessionId);
  }
}

export const ChatMessageResponseEventName = 'chat.message.response';
export class ChatMessageResponseEvent extends ChatEvent {
  public readonly event = ChatMessageResponseEventName;
}

export const ChatStatusResponseEventName = 'chat.status.response';
export class ChatStatusResponseEvent extends ChatEvent {
  public readonly event = ChatStatusResponseEventName;
}

export const ChatFeedbackEventName = 'chat.feedback';
export class ChatFeedbackEvent extends ChatEvent {
  public readonly event = ChatFeedbackEventName;

  constructor(
    public readonly sessionId: string,
    public readonly message: string,
    public readonly feedback: string,
  ) {
    super(message, sessionId);
  }
}
