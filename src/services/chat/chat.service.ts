import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Content } from '@google/genai';

import { Chat, ChatDocument, ChatMessage } from '../../schemas/chat.schema';
import { PromptusService } from '../promptus/promptus.service';
import { ChatPromptusRequest } from '../promptus/request/chat.promptus.request';
import { ChatContext, newId } from './chat-context';
import { ChatStreamService } from './chat-stream.service';
import { SessionId } from '../session/session.service';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * Chat CRUD, and one turn of conversation.
 *
 * Everything that used to make this class complicated is gone: the `Map<ChannelName, Subject>`
 * beside its `Map<ChannelName, Subscription>`, the `channels` suffix array they were swept with,
 * the RxJS `delayWhen` connection gate, and the dead status subject that was registered under a
 * fourth suffix the sweep array could not contain. Delivery is `ChatStreamService`'s job now, and
 * feedback is `FeedbackService`'s.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly promptusService: PromptusService,
    private readonly chatStream: ChatStreamService,
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

  /**
   * One turn: record what the user said, run the agent, publish the answer.
   *
   * The user's own message is an envelope like any other, and a persisted one. Without it, history
   * replay and any second device would show the assistant answering a question nobody asked. It
   * carries the `clientId` the app minted so the optimistic bubble already on screen adopts the
   * server's id rather than rendering a duplicate beside it.
   */
  async chat(sessionId: SessionId, chatId: string, text: string, clientId: string): Promise<void> {
    const ctx: ChatContext = { sessionId, chatId, turnId: newId() };

    await this.chatStream.emit(ctx, { type: 'text', format: 'plain', text }, { role: 'user', clientId, actions: [{ kind: 'copy' }] });

    try {
      const history = await this.getHistory(chatId);
      const request = new ChatPromptusRequest(text, history);
      const response = await this.promptusService.generate(request, ctx);

      // No addHistory here: the agent loop already pushed every candidate's content onto
      // `request.history`, the final turn included.
      await this.saveHistory(chatId, request.history);

      if (response.text) {
        await this.chatStream.emit(ctx, { type: 'text', format: 'markdown', text: response.text }, { actions: [{ kind: 'copy' }] });
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error(`Turn failed for chat ${chatId}: ${message}`);

      // The user is owed an answer even when the agent throws. `retryable` is what puts a retry
      // action on the bubble rather than leaving a dead end.
      await this.chatStream.emit(
        ctx,
        { type: 'error', code: 'turn_failed', message: 'Something went wrong working that out.', retryable: true },
        { state: 'failed', actions: [{ kind: 'retry' }] },
      );
    }
  }
}
