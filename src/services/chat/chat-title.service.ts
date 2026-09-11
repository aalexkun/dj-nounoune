import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Content } from '@google/genai';
import { Model, Types } from 'mongoose';

import { Chat, ChatDocument } from '../../schemas/chat.schema';
import { PromptusService } from '../promptus/promptus.service';
import { ChatTitleRequest, ChatTitleTurn } from '../promptus/request/chat-title.request';
import { SessionId } from '../session/session.service';
import { getErrorMessage } from '../../utils/error.utils';
import { sessionContext } from './chat-context';
import { ChatStreamService } from './chat-stream.service';

/** Titles that name nothing. A chat wearing one of these is renamed on the first message. */
const PLACEHOLDER_TITLES = new Set(['', 'new chat', 'new conversation', 'my first chatroom', 'chatroom', 'untitled']);

/**
 * How much of the transcript the model is shown.
 *
 * The last few exchanges plus the first — the opening is what the title usually comes from, and the
 * tail is what would justify changing it. Everything between is the part a two-to-five word label
 * was never going to capture anyway, and sending it would make the cheapest request in the project
 * grow without bound over the life of a conversation.
 */
const HEAD_TURNS = 2;
const TAIL_TURNS = 8;

/** A single turn past this is a wall of text; the subject is in its opening either way. */
const MAX_TURN_CHARS = 400;

/**
 * Names the conversation, and keeps naming it.
 *
 * Runs **beside** a turn rather than inside it: `ChatService.chat` starts it and does not await it,
 * so the disc jockey's answer is never held up by a bookkeeping call, and a failure here costs the
 * user nothing but the old title. That is also why every path through this class swallows its own
 * errors — there is no caller left to report them to.
 *
 * The rename reaches the app twice over, on purpose. The durable half is `Chat.topic`, which is
 * what the chatroom listing returns on the next connect; the live half is a session-scoped
 * `chat_title` envelope, which is what moves the header while the user is looking at it. Neither
 * alone is enough: without the envelope the title only changes when you restart the app, and
 * without the document it changes back.
 *
 * The envelope goes to the session that sent the message, and only that one. A second device on its
 * own session sees the new name on its next connect, out of the listing — which is the durable half
 * doing exactly the job it is there for, and the reason this is not worth a broadcast.
 */
@Injectable()
export class ChatTitleService {
  private readonly logger = new Logger(ChatTitleService.name);

  /**
   * Chats with a consideration already in flight.
   *
   * Two messages sent inside one model call would otherwise produce two renames racing to the same
   * document, and the one that lands second is the one that saw *less* of the conversation. Skipping
   * the second is free: the next message reconsiders anyway, and by then the answer is in the
   * transcript too.
   */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly promptus: PromptusService,
    private readonly chatStream: ChatStreamService,
    @InjectModel(Chat.name) private readonly chatModel: Model<ChatDocument>,
  ) {}

  /**
   * Consider renaming `chatId`, and never throw.
   *
   * `latest` is the message that has just arrived. It is passed in rather than read back because at
   * the moment this is called the turn is still running and the agent loop has not yet written its
   * history — the one message most likely to decide the title would otherwise be the one missing.
   *
   * The chat is read whole, which is one indexed lookup the turn is making at the same moment for
   * the same document. Not shared, because sharing it would mean waiting for it: the point of this
   * method is that nothing on the user's path is blocked by it. The transcript is not sliced in the
   * query either — `window` wants the opening *and* the tail, and losing the opening is what would
   * make a long conversation keep re-titling itself off its most recent tangent.
   */
  async consider(sessionId: SessionId, chatId: string, latest: string): Promise<void> {
    if (this.inFlight.has(chatId)) return;
    this.inFlight.add(chatId);

    try {
      const chat = await this.chatModel.findById(new Types.ObjectId(chatId)).select({ topic: 1, history: 1 }).exec();
      if (!chat) return;

      const current = chat.topic ?? '';
      const turns = [...transcript(chat.history ?? []), { role: 'user' as const, text: latest.slice(0, MAX_TURN_CHARS) }];

      const response = await this.promptus.generate(new ChatTitleRequest(current, window(turns)));

      // The third test is not paranoia about the schema, it is about the model: asked whether a
      // conversation called "New chat" needs renaming, the cheap answer is `rename: true` with the
      // current title echoed straight back. Applying that would log a rename that changed nothing.
      if (!response.rename || response.title === current || isPlaceholder(response.title)) return;

      await this.chatModel.updateOne({ _id: new Types.ObjectId(chatId) }, { $set: { topic: response.title } }).exec();
      this.logger.log(`Chat ${chatId} renamed: "${current}" -> "${response.title}"`);

      // Session-scoped: the title is not a thing that was said, and a chat-scoped envelope would
      // land in the timeline as a bubble on any client that did not know the type.
      await this.chatStream.emit(sessionContext(sessionId), { type: 'chat_title', chatId, title: response.title }, { role: 'system' });
    } catch (error: unknown) {
      // Nobody is waiting on this. The conversation keeps the name it had.
      this.logger.warn(`Could not title chat ${chatId}: ${getErrorMessage(error)}`);
    } finally {
      this.inFlight.delete(chatId);
    }
  }
}

/** Whether a title names nothing — the state a chat is created in, and never a valid rename. */
function isPlaceholder(title: string | undefined): boolean {
  return PLACEHOLDER_TITLES.has((title ?? '').trim().toLowerCase());
}

/**
 * Gemini's transcript, reduced to what was actually said.
 *
 * The stored history is the model's, not the user's: it carries `functionCall` and
 * `functionResponse` parts, and a tool result is several hundred tokens of pipe-separated song rows
 * that say nothing about what the conversation is *about*. Only text parts survive, and a turn left
 * with nothing is dropped rather than sent as an empty line.
 */
function transcript(history: Content[]): ChatTitleTurn[] {
  return history
    .map((content) => {
      const text = (content.parts ?? [])
        .map((part) => part.text ?? '')
        .join(' ')
        .trim();

      // `agent.ts` writes function-response turns as `MODEL` in capitals; anything that is not the
      // user is the assistant as far as a title is concerned.
      const role = (content.role ?? '').toLowerCase() === 'user' ? ('user' as const) : ('assistant' as const);

      return { role, text: text.slice(0, MAX_TURN_CHARS) };
    })
    .filter((turn) => turn.text.length > 0);
}

/** The opening and the tail, with anything in between dropped. */
function window(turns: ChatTitleTurn[]): ChatTitleTurn[] {
  if (turns.length <= HEAD_TURNS + TAIL_TURNS) return turns;

  return [...turns.slice(0, HEAD_TURNS), ...turns.slice(-TAIL_TURNS)];
}
