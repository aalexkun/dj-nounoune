import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Chat, ChatDocument } from '../../schemas/chat.schema';
import { ChatEnvelopeDoc, ChatEnvelopeDocument } from '../../schemas/chat-envelope.schema';
import { getErrorMessage } from '../../utils/error.utils';

/** How many conversations a user keeps when `CHAT_HISTORY_LIMIT` says nothing. */
const DEFAULT_LIMIT = 20;

/**
 * A limit this low is almost certainly a typo for "off", and it would silently eat the chat the
 * user is sitting in. Retention refuses rather than guesses.
 */
const MIN_LIMIT = 1;

/** What one pass did, so the CLI and the scheduler can report the same numbers. */
export interface ChatPruneResult {
  /** Users whose chats were examined. */
  users: number;
  chatsDeleted: number;
  envelopesDeleted: number;
  /** True when nothing was written, because the caller asked for a dry run. */
  dryRun: boolean;
}

/**
 * Keeps the newest `CHAT_HISTORY_LIMIT` conversations per user and drops the rest.
 *
 * **Per user, not per server.** `userId` is on the document and indexed, and a global ceiling would
 * mean one chatty account evicting another's history — a bug that only shows up on the second
 * account, which is to say after it ships.
 *
 * **Ordered by `updatedAt`.** A conversation you came back to this morning is more current than one
 * you opened last week, whatever their creation dates say. The listing sorts the same way, so what
 * falls off the bottom of the history sheet is exactly what this deletes.
 *
 * The envelopes go with the chat. `chat_message` is keyed on `chatId` and reachable no other way,
 * so a chat deleted without its timeline leaves that timeline in the collection forever.
 */
@Injectable()
export class ChatRetentionService {
  private readonly logger = new Logger(ChatRetentionService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Chat.name) private readonly chatModel: Model<ChatDocument>,
    @InjectModel(ChatEnvelopeDoc.name) private readonly envelopeModel: Model<ChatEnvelopeDocument>,
  ) {}

  /**
   * The configured ceiling, or the default.
   *
   * Read on every pass rather than captured in the constructor so that changing it is a restart of
   * the process at worst, never a rebuild.
   */
  get limit(): number {
    const configured = Number(this.configService.get<string>('CHAT_HISTORY_LIMIT'));

    if (!Number.isFinite(configured) || configured < MIN_LIMIT) return DEFAULT_LIMIT;

    return Math.floor(configured);
  }

  async prune(dryRun = false): Promise<ChatPruneResult> {
    const limit = this.limit;
    const result: ChatPruneResult = { users: 0, chatsDeleted: 0, envelopesDeleted: 0, dryRun };

    // One user at a time. The alternative is an aggregation that ranks every chat on the server in
    // one pipeline, which is more machinery than a handful of accounts is worth and harder to read
    // than the thing it replaces.
    const userIds = await this.chatModel.distinct('userId').exec();

    for (const userId of userIds) {
      if (typeof userId !== 'string') continue;
      result.users++;

      // Only the ids, and only the ones past the ceiling: `skip` after a sort is what turns "keep
      // the newest twenty" into a query rather than a list to filter in memory.
      const doomed = await this.chatModel.find({ userId }).select({ _id: 1 }).sort({ updatedAt: -1 }).skip(limit).exec();

      if (doomed.length === 0) continue;

      const ids = doomed.map((chat) => chat._id.toString());

      if (dryRun) {
        result.chatsDeleted += ids.length;
        result.envelopesDeleted += await this.envelopeModel.countDocuments({ chatId: { $in: ids } }).exec();
        continue;
      }

      // Envelopes first. Interrupted the other way round the chats are gone and their timelines are
      // unreachable, which is the one outcome no later pass can clean up.
      const envelopes = await this.envelopeModel.deleteMany({ chatId: { $in: ids } }).exec();
      const chats = await this.chatModel.deleteMany({ _id: { $in: doomed.map((chat) => chat._id) } }).exec();

      result.envelopesDeleted += envelopes.deletedCount ?? 0;
      result.chatsDeleted += chats.deletedCount ?? 0;
    }

    if (result.chatsDeleted > 0) {
      this.logger.log(
        `${dryRun ? 'Would prune' : 'Pruned'} ${result.chatsDeleted} chat(s) and ${result.envelopesDeleted} envelope(s) across ${result.users} user(s), keeping ${limit} each`,
      );
    }

    return result;
  }

  /** The scheduler's entry point: never throws, because there is no caller to tell. */
  async pruneQuietly(): Promise<void> {
    try {
      await this.prune();
    } catch (error: unknown) {
      this.logger.error(`Chat retention pass failed: ${getErrorMessage(error)}`);
    }
  }
}
