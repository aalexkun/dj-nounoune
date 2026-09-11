import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Content } from '@google/genai';

import { Chat, ChatDocument, ChatMessage } from '../../schemas/chat.schema';
import { ChatEnvelopeDoc, ChatEnvelopeDocument } from '../../schemas/chat-envelope.schema';
import { PromptusService } from '../promptus/promptus.service';
import { ChatPromptusRequest } from '../promptus/request/chat.promptus.request';
import { ChatContext, newId } from './chat-context';
import { ChatStreamService } from './chat-stream.service';
import { ChatTitleService } from './chat-title.service';
import { SessionId } from '../session/session.service';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * One row of the chatroom listing: what the history sheet draws, and nothing else.
 *
 * Deliberately not a `Chat`. The document carries `history` — Gemini `Content[]`, tool calls and
 * pipe-separated tool results included — and returning it whole made the listing a transfer of
 * every transcript on the server, decoded on the phone by a second, divergent mapping of the model
 * API's own shape. That mapping is what threw: `functionResponse.response.output` is a string when
 * a handler returned text and an object when it returned anything else, and the client had declared
 * it a string.
 *
 * So the list route answers in this shape instead, and the transcript is reachable only through the
 * route that is actually about one conversation. `lastMessage` comes from the envelope log rather
 * than from the transcript, which is both cheaper and more honest: it is the same `copyText` the
 * app would have rendered.
 */
export interface ChatSummary {
  id: string;
  title: string;
  userId: string;
  lastMessage: string;
  createdAt: number;
  updatedAt: number;
}

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
    private readonly chatTitle: ChatTitleService,
    @InjectModel(Chat.name) private readonly chatModel: Model<ChatDocument>,
    @InjectModel(ChatEnvelopeDoc.name) private readonly envelopeModel: Model<ChatEnvelopeDocument>,
  ) {}

  async findAll(): Promise<Chat[]> {
    return await this.chatModel.find().exec();
  }

  /**
   * The chatroom listing, newest first.
   *
   * Sorted on `updatedAt` rather than `createdAt` because a conversation you came back to this
   * morning is more current than one you opened last week — and because that is the order the
   * retention pass prunes in, so the list and the cull agree about which chats are old.
   *
   * `limit` exists so the listing cannot outgrow the retention ceiling even in the hour before the
   * cull runs, or on a deploy where the cull is off.
   */
  async summaries(userId?: string, limit = 50): Promise<ChatSummary[]> {
    const filter = userId ? { userId } : {};

    // `history` is excluded at the database rather than after: it is the whole reason this route
    // used to be heavy, and a projection is the only place that fact can be stated once.
    const chats = await this.chatModel.find(filter).select({ history: 0 }).sort({ updatedAt: -1 }).limit(limit).exec();

    const previews = await this.lastMessages(chats.map((chat) => chat._id.toString()));

    return chats.map((chat) => summaryOf(chat, previews.get(chat._id.toString())));
  }

  /**
   * The newest envelope's `copyText` per chat, in one round trip.
   *
   * `seq` rather than a timestamp: it is the chat's own monotonic counter, it is the first key of
   * the index the resync query already needs, and it is right for a revised envelope too — a
   * republished message keeps its seq, so a playlist the queue watcher touched an hour ago does not
   * climb to the top of the preview.
   */
  private async lastMessages(chatIds: string[]): Promise<Map<string, string>> {
    if (chatIds.length === 0) return new Map();

    try {
      const rows = await this.envelopeModel
        .aggregate<{ _id: string; copyText: string }>([
          { $match: { chatId: { $in: chatIds } } },
          { $sort: { chatId: 1, seq: -1 } },
          { $group: { _id: '$chatId', copyText: { $first: '$copyText' } } },
        ])
        .exec();

      return new Map(rows.map((row) => [row._id, row.copyText ?? '']));
    } catch (error: unknown) {
      // A listing with no previews is worth more than no listing.
      this.logger.warn(`Could not read chat previews: ${getErrorMessage(error)}`);
      return new Map();
    }
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

  /**
   * A new conversation, under a name that says it has none yet.
   *
   * The placeholder is deliberate and is the titler's cue: `ChatTitleService` renames a chat
   * wearing one on the first message, whatever the evidence, where it would otherwise prefer to
   * leave a title alone. A client that sends its own topic keeps it.
   */
  async create(topic: string, userId: string): Promise<ChatDocument> {
    const createdChat = new this.chatModel({ userId, topic: topic?.trim() || 'New chat', history: [] });
    return createdChat.save();
  }

  /**
   * Deletes the conversation and the timeline under it.
   *
   * The envelope log is keyed on `chatId` and nothing else refers to it, so a chat removed without
   * this leaves its whole timeline in `chat_message` permanently — unreachable, because the only
   * query that would find it starts from a chat document that no longer exists.
   */
  async remove(id: string): Promise<void> {
    const result = await this.chatModel.findByIdAndDelete(new Types.ObjectId(id)).exec();
    if (!result) {
      throw new NotFoundException(`Chat with ID ${id} not found`);
    }

    await this.envelopeModel.deleteMany({ chatId: id }).exec();
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

    // Beside the turn, not before or after it. Naming the conversation is worth a model call but
    // not a moment of the user's time, and it is the one thing here that is allowed to fail
    // silently — the chat keeps the name it had. It is handed `text` explicitly because the agent
    // loop has not written this turn to `history` yet, and on the first message of a chat that one
    // sentence is the entire evidence for the title.
    void this.chatTitle.consider(sessionId, chatId, text);

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

/**
 * A Mongoose timestamp, off a class that does not declare one.
 *
 * `@Schema({ timestamps: true })` adds `createdAt` and `updatedAt` to the documents but not to the
 * class the document type is derived from, so there is no typed way to reach them. Narrowed out of
 * `unknown` rather than cast through `any`, and given a present-day fallback: a summary with a
 * plausible date sorts sensibly, a summary with `NaN` does not.
 */
export function summaryOf(chat: ChatDocument, lastMessage = ''): ChatSummary {
  return {
    id: chat._id.toString(),
    title: chat.topic ?? '',
    userId: chat.userId,
    lastMessage,
    createdAt: timestamp(chat, 'createdAt'),
    updatedAt: timestamp(chat, 'updatedAt'),
  };
}

function timestamp(doc: ChatDocument, field: 'createdAt' | 'updatedAt'): number {
  const value: unknown = (doc as unknown as Record<string, unknown>)[field];

  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  return Date.now();
}
