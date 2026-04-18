import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Chat, ChatDocument, ChatMessage } from '../../schemas/chat.schema';
import { Content } from '@google/genai';
import { bufferTime, delayWhen, filter, map, of, Subject, Subscription, take } from 'rxjs';
import * as chatGatewayTypes from '../../gateway/chat.gateway.types';
import { NounouneSession, SessionId } from '../session/session.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PromptusService } from '../promptus/promptus.service';
import { ChatPromptusRequest } from '../promptus/request/chat.promptus.request';
import { ChatEvent, ChatFeedbackEvent, ChatMessageEvent, ChatMessageResponseEvent, ChatMessageResponseEventName } from './chat.event';

export type ChannelName =
  | `${SessionId}-chat-feedback`
  | `${SessionId}-chat-message`
  | `${SessionId}-chat-message-status-response`
  | `${SessionId}-user-status`;

@Injectable()
export class ChatService {
  private logger = new Logger('ChatService');
  private channels: ChannelName[] = ['-chat-feedback', '-chat-message', '-chat-message-status-response'];
  private clientSubjects = new Map<ChannelName, Subject<ChatEvent>>();
  private clientSubscriptions = new Map<ChannelName, Subscription>();

  constructor(
    private readonly promptusService: PromptusService,
    private eventEmitter: EventEmitter2,
    @InjectModel(Chat.name) private readonly chatModel: Model<ChatDocument>,
  ) {}

  async findAll(): Promise<Chat[]> {
    return await this.chatModel.find().exec();
  }

  async findOne(id: string): Promise<Chat> {
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    return chat;
  }

  async update(id: string, updateChatDto: Partial<Chat>): Promise<Chat> {
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    Object.assign(chat, updateChatDto);
    return chat.save();
  }

  async create(topic: string, userId: string): Promise<Chat> {
    const createdChat = new this.chatModel({ userId, topic, history: [] });
    return createdChat.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.chatModel.findByIdAndDelete(new Types.ObjectId(id)).exec();
    if (!result) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
  }

  async getHistory(id: string): Promise<ChatMessage[]> {
    console.log(`Retrieving history for chat with ID: ${id}`);
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    return chat.history;
  }
  async saveHistory(id: string, history: ChatMessage[] | Content[]): Promise<void> {
    const chat = await this.chatModel.findById(new Types.ObjectId(id)).exec();
    if (!chat) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }
    chat.history = history;
    await chat.save();
  }

  public unSubscribeSession(sessionId: string) {
    for (const channel of this.channels) {
      this.clientSubjects.get(`${sessionId}${channel}`)?.complete();
      this.clientSubscriptions.get(`${sessionId}${channel}`)?.unsubscribe();
      this.clientSubjects.delete(`${sessionId}${channel}`);
      this.clientSubscriptions.delete(`${sessionId}${channel}`);
    }

    this.logger.log(`Unsubscribed from session ${sessionId}`);
  }

  public subscribeToFeedback(sessionId: SessionId): Subject<ChatFeedbackEvent> {
    const subject = new Subject<ChatFeedbackEvent>();
    const subscription = subject
      .pipe(
        bufferTime(5000),
        filter((bufferedMessages) => bufferedMessages?.length > 0),
        map((bufferedMessages) => {
          // 2. Reduce the array into an object that counts each feedback type
          return bufferedMessages.reduce((acc, message) => {
            const type = message.feedback;
            // Initialise at 0 if it doesn't exist, then increment by 1
            acc[type] = (acc[type] || 0) + 1;
            return acc;
          }, {});
        }),
      )
      .subscribe((groupedCounts) => {
        // 3. The output will now be an object instead of a single integer
        this.logger.log('Count of reactions over the last 5 seconds:', groupedCounts);

        // Example output in your logs:
        // { awesome: 4, wtf: 1, great: 2 }
      });

    this.clientSubjects.set(`${sessionId}-chat-feedback`, subject);
    this.clientSubscriptions.set(`${sessionId}-chat-feedback`, subscription);
    return subject;
  }

  public subscribeToChat(session: NounouneSession): Subject<ChatEvent> {
    const persistentId = session.id;

    // Create a reusable delay function to keep the code DRY
    const waitForActiveConnection = () => {
      // If there is no tracker, assume they are connected and let it pass instantly
      if (!session.status) {
        return of(true);
      }

      // If the tracker exists, wait for the behaviour subject to emit 'active'
      return session.status.pipe(
        filter((status) => status === 'active'),
        take(1),
      );
    };

    // --- 1. Setup Status Stream ---
    const statusSubject = new Subject<ChatEvent>();
    const statusSubscription = statusSubject
      .pipe(
        delayWhen(waitForActiveConnection), // Apply the pause logic
      )
      .subscribe((status) => {
        this.logger.debug(`chat-message-status-response to ${persistentId}`);
        this.eventEmitter.emit(`chat-message-status-response`, { sessionId: persistentId, message: status });
      });

    // Track by persistent ID
    this.clientSubjects.set(`${persistentId}-chat-status` as ChannelName, statusSubject);
    this.clientSubscriptions.set(`${persistentId}-chat-status` as ChannelName, statusSubscription);

    // --- 2. Setup Main Chat Stream ---
    const subject = new Subject<ChatEvent>();
    const subscription = subject.pipe(delayWhen(waitForActiveConnection)).subscribe((message) => {
      this.eventEmitter.emit(ChatMessageResponseEventName, new ChatMessageResponseEvent(message.message, persistentId));
    });

    this.clientSubjects.set(`${persistentId}-chat-message`, subject);
    this.clientSubscriptions.set(`${persistentId}-chat-message`, subscription);

    return subject;
  }

  public processFeedbackMessage(sessionId: string, payload: ChatFeedbackEvent) {
    if (this.clientSubjects.has(`${sessionId}-chat-feedback`)) {
      this.clientSubjects.get(`${sessionId}-chat-feedback`)?.next(payload);
    } else {
      this.logger.warn(`No feedback subject found for session ${sessionId}`);
    }
  }

  public async processChatMessage(sessionId: string, payload: ChatMessageEvent) {
    if (!this.clientSubjects.has(`${sessionId}-chat-message`)) {
      this.logger.warn(`No chat subject found for session ${sessionId}`);
      return;
    }

    await this.chat(sessionId, payload);
  }

  public sendChatMessageResponse(payload: ChatMessageResponseEvent) {
    if (!this.clientSubjects.has(`${payload.sessionId}-chat-message`)) {
      this.logger.warn(`No chat subject found for session ${payload.sessionId}`);
      return;
    }

    this.clientSubjects.get(`${payload.sessionId}-chat-message`)?.next(payload);
  }

  public async chat(sessionId: string, payload: ChatMessageEvent) {
    let aiResponse = '';

    const history = await this.getHistory(payload.chatId);
    const request = new ChatPromptusRequest(payload.message, history);
    const response = await this.promptusService.generate(request, sessionId);

    if (response.content) {
      request.addHistory(response.content);
    }

    if (response.text) {
      aiResponse = response.text;
    }

    await this.saveHistory(payload.chatId, request.history);

    this.sendChatMessageResponse(new ChatMessageResponseEvent(aiResponse, sessionId));
  }
}
