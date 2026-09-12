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

/** The name a conversation wears until `ChatTitleService` renames it on the first message. */
const PLACEHOLDER_TOPIC = 'New chat';

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

  /**
   * The chatroom listing, newest first, and only this user's.
   *
   * `userId` is required rather than optional. It used to be a filter the caller could omit, and an
   * omitted filter meant every conversation on the server — which was the CLI's convenience and
   * everybody else's leak, since the id it scoped by was whatever `x-user-id` the caller chose to
   * send. Ownership now comes from the session and there is no caller left that wants the lot.
   *
   * Sorted on `updatedAt` rather than `createdAt` because a conversation you came back to this
   * morning is more current than one you opened last week — and because that is the order the
   * retention pass prunes in, so the list and the cull agree about which chats are old.
   *
   * `limit` exists so the listing cannot outgrow the retention ceiling even in the hour before the
   * cull runs, or on a deploy where the cull is off.
   */
  async summaries(userId: string, limit = 50): Promise<ChatSummary[]> {
    // `history` is excluded at the database rather than after: it is the whole reason this route
    // used to be heavy, and a projection is the only place that fact can be stated once.
    const chats = await this.chatModel.find({ userId }).select({ history: 0 }).sort({ updatedAt: -1 }).limit(limit).exec();

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

  async findOne(id: string, userId: string): Promise<Chat> {
    return this.byIdAndOwner(id, userId);
  }

  /**
   * Refuses unless this user owns this chat, and reads nothing back.
   *
   * For the callers that are about to work on a conversation through another service — the REST
   * `/messages` route, which hands the id to `ChatStreamService`, and every socket frame that names
   * a `chatId`. One indexed query, no document loaded, and the same 404 semantics as the rest of
   * this class.
   */
  async assertOwned(id: string, userId: string): Promise<void> {
    const objectId = toObjectId(id);
    if (!objectId) throw notFound(id);

    const owned = await this.chatModel.exists({ _id: objectId, userId }).exec();
    if (!owned) throw notFound(id);
  }

  async update(id: string, updateChatDto: Partial<Chat>): Promise<Chat> {
    const chat = await this.byId(id);
    Object.assign(chat, updateChatDto);
    return chat.save();
  }

  /**
   * One chat, by id **and** by owner.
   *
   * The owner is a clause of the query rather than a check after it, which is the whole point: a
   * route that forgets to check cannot exist when there is nothing separate to forget.
   *
   * A chat that exists but belongs to somebody else is reported as missing, deliberately. A 403
   * would confirm that the id names a real conversation, and chat ids are guessable enough that
   * confirming existence is itself the leak.
   */
  private async byIdAndOwner(id: string, userId: string): Promise<ChatDocument> {
    const objectId = toObjectId(id);
    if (!objectId) throw notFound(id);

    const chat = await this.chatModel.findOne({ _id: objectId, userId }).exec();
    if (!chat) throw notFound(id);

    return chat;
  }

  /**
   * One chat by id alone, for the paths where ownership was already settled upstream.
   *
   * The agent loop reads and rewrites the transcript of a turn the gateway admitted only after
   * `assertOwned`; re-checking on every write would be a second query answering a question that has
   * already been answered for this frame.
   */
  private async byId(id: string): Promise<ChatDocument> {
    const objectId = toObjectId(id);
    if (!objectId) throw notFound(id);

    const chat = await this.chatModel.findById(objectId).exec();
    if (!chat) throw notFound(id);

    return chat;
  }

  /**
   * A new conversation — or the one this user already has open and has not written in yet.
   *
   * A client asks for a chat the moment somebody opens the window, well before they type, so a
   * user who opened it five times left five documents behind. Those count against
   * `ChatRetentionService`'s per-user ceiling, which means abandoned blanks evicting real
   * conversations from the history sheet — the reason they are worth preventing rather than
   * merely hiding.
   *
   * An unused chat is handed back instead of a new one. Nothing is lost: it has no history and no
   * envelopes, so the only thing that distinguishes it is its id, and at most one blank per user
   * survives — the one they are sitting in.
   *
   * The placeholder topic is deliberate and is the titler's cue: `ChatTitleService` renames a chat
   * wearing one on the first message, whatever the evidence, where it would otherwise prefer to
   * leave a title alone. A client that sends its own topic keeps it, on a reused chat too.
   */
  async create(topic: string, userId: string): Promise<ChatDocument> {
    const wanted = topic?.trim() || PLACEHOLDER_TOPIC;
    const unused = await this.findUnusedChat(userId);

    if (unused) {
      if (unused.topic !== wanted) {
        unused.topic = wanted;
        await unused.save();
      }

      this.logger.debug(`Reusing empty chat ${unused._id.toString()} rather than creating another for ${userId}`);
      return unused;
    }

    const createdChat = new this.chatModel({ userId, topic: wanted, history: [] });
    return createdChat.save();
  }

  /**
   * This user's newest conversation, but only when there is nothing in it at all.
   *
   * An empty `history` is not enough on its own. The timeline lives in `chat_message` keyed on
   * `chatId`, so a chat could hold envelopes a client is already rendering while its history array
   * is still empty, and handing that one back would splice two conversations together. Both have to
   * be empty before the document counts as unused.
   */
  private async findUnusedChat(userId: string): Promise<ChatDocument | null> {
    if (!userId) return null;

    const candidate = await this.chatModel
      .findOne({ userId, $or: [{ history: { $size: 0 } }, { history: { $exists: false } }] })
      .sort({ updatedAt: -1 })
      .exec();

    if (!candidate) return null;

    // `exists` stops at the first envelope; a count would walk the whole timeline to learn "not zero".
    const used = await this.envelopeModel.exists({ chatId: candidate._id.toString() }).exec();

    return used ? null : candidate;
  }

  /** How many conversations one owner holds, for the CLI's account listing and the `auth claim` report. */
  async countOwned(userId: string): Promise<number> {
    return this.chatModel.countDocuments({ userId }).exec();
  }

  /**
   * Conversations per `userId`, in one pass, keyed on the raw value the documents carry.
   *
   * A legacy id that no `auth claim` has moved yet is its own key and matches no account, which is
   * the honest answer and the reason to run the claim.
   */
  async countPerOwner(): Promise<Map<string, number>> {
    const rows = await this.chatModel.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$userId', count: { $sum: 1 } } }]).exec();

    return new Map(rows.map((row) => [row._id, row.count]));
  }

  /**
   * Hands every conversation of one owner to another, and says how many moved.
   *
   * The one-way migration from the pre-sign-in user ids (whatever the phone asserted) to a `User`
   * document's `_id`. Envelopes are untouched: `chat_message` is keyed on `chatId`, so the timeline
   * follows the conversation. It lives here rather than in the CLI because `Chat.userId` is this
   * class's key — the clause every read filters on — and nothing else should write it.
   */
  async reassignOwner(from: string, to: string): Promise<number> {
    const result = await this.chatModel.updateMany({ userId: from }, { $set: { userId: to } }).exec();

    return result.modifiedCount;
  }

  /**
   * Deletes the conversation and the timeline under it.
   *
   * The envelope log is keyed on `chatId` and nothing else refers to it, so a chat removed without
   * this leaves its whole timeline in `chat_message` permanently — unreachable, because the only
   * query that would find it starts from a chat document that no longer exists.
   *
   * The owner is part of the delete, so somebody else's id deletes nothing and is answered 404.
   */
  async remove(id: string, userId: string): Promise<void> {
    const objectId = toObjectId(id);
    if (!objectId) throw notFound(id);

    const result = await this.chatModel.findOneAndDelete({ _id: objectId, userId }).exec();
    if (!result) throw notFound(id);

    await this.envelopeModel.deleteMany({ chatId: id }).exec();
  }

  async getHistory(id: string, userId: string): Promise<ChatMessage[]> {
    return (await this.byIdAndOwner(id, userId)).history;
  }

  async saveHistory(id: string, history: ChatMessage[] | Content[]): Promise<void> {
    const chat = await this.byId(id);
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
      // By id alone: the gateway admitted this frame only after `assertOwned`, so the owner is
      // settled for the whole turn.
      const history = (await this.byId(chatId)).history;
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
 * A chat id as Mongo understands it, or nothing.
 *
 * `new Types.ObjectId(x)` throws on anything that is not twenty-four hex characters, and a throw out
 * of a service is a 500. A malformed id is not a server fault: it names no chat, so it gets the same
 * answer as an id that names somebody else's.
 */
function toObjectId(id: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}

/** The one answer for "no such chat", "not yours" and "not an id". They must be indistinguishable. */
function notFound(id: string): NotFoundException {
  return new NotFoundException(`Chat with ID ${id} not found`);
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
