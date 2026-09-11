import { z } from 'zod';
import { ActionParamsSchema, ChatActionSchema } from './action.schema';
import { VerbositySchema } from './envelope.schema';

/**
 * Every frame the client may send, and the socket event each arrives on.
 *
 * These are parsed with `safeParse` in the gateway before anything downstream sees them. The old
 * gateway typed its `@MessageBody()` and never checked it, which is a type assertion rather than
 * validation — a malformed frame walked straight into `ChatService`.
 */
export const ChatSendMessage = 'chat:send';
export const ChatEditMessage = 'chat:edit';
export const ChatFeedbackMessage = 'chat:feedback';
export const ChatResyncMessage = 'chat:resync';
export const ChatActionMessage = 'chat:action';
export const ChatRefreshMessage = 'chat:refresh';
export const ChatSetVerbosityMessage = 'chat:set_verbosity';

/** Server → client. One envelope, and a batch for replay/backfill. */
export const ChatEventMessage = 'chat:event';
export const ChatBatchMessage = 'chat:batch';

/**
 * `clientId` is minted by the app for its optimistic bubble and echoed back on the persisted
 * user envelope, so the bubble reconciles by id instead of duplicating.
 */
export const ChatSendSchema = z.object({
  chatId: z.string(),
  clientId: z.string(),
  text: z.string().min(1),
});
export type ChatSend = z.infer<typeof ChatSendSchema>;

/**
 * Defined, wired, and answered with `not_implemented`.
 *
 * Editing needs the server to cancel an in-flight agent loop, mark its envelopes failed and emit a
 * fresh `turnId`. That work is out of scope; the frame exists so the app can be built against it
 * and so adding it later is not a protocol change.
 */
export const ChatEditSchema = z.object({
  chatId: z.string(),
  id: z.string(),
  text: z.string().min(1),
});
export type ChatEdit = z.infer<typeof ChatEditSchema>;

/** The four reactions `PlaylogService.handleFeedbackEvent` will count. Anything else is dropped. */
export const ReactionSchema = z.enum(['awesome', 'great', 'duh', 'wtf']);
export type Reaction = z.infer<typeof ReactionSchema>;

export const ChatFeedbackSchema = z.object({
  chatId: z.string().optional(),
  feedback: ReactionSchema,
});
export type ChatFeedback = z.infer<typeof ChatFeedbackSchema>;

/**
 * Backfill request. Both cursors are exclusive, and the client passes the highest it holds of each.
 *
 * `sinceSeq` alone cannot ask for a *revision*: a republished envelope keeps its seq and only bumps
 * `rev`, so the messages most likely to have gone stale while the client was away — the live
 * playlist above all — are precisely the ones a seq cursor can never return. `sinceUpdatedAt` is
 * what asks for those. Omitting it is still valid and means "new messages only".
 */
export const ChatResyncSchema = z.object({
  chatId: z.string(),
  sinceSeq: z.number().int().nonnegative().default(0),
  sinceUpdatedAt: z.number().int().nonnegative().default(0),
});
export type ChatResync = z.infer<typeof ChatResyncSchema>;

/**
 * `chatId` is optional because a session-scoped target — the transport bar — has none.
 *
 * The `action` is echoed back rather than composed, and the server re-derives the declared set for
 * the named target before executing it, so a forged frame finds nothing to run. `params` carries
 * the one class of value that legitimately originates on the client (a seek position), validated
 * against the range the declaration carried.
 */
export const ChatActionRequestSchema = z.object({
  chatId: z.string().optional(),
  messageId: z.string(),
  elementId: z.string().optional(),
  action: ChatActionSchema,
  params: ActionParamsSchema.optional(),
});
export type ChatActionRequest = z.infer<typeof ChatActionRequestSchema>;

/**
 * "Re-read the daemon and tell me what it says."
 *
 * The counterpart to `chat:resync`, and deliberately not the same frame. Resync is about *history*:
 * it carries a cursor, it answers out of the durable log, and it is the client saying what it
 * already holds. This is about **live state**, which has no history and no cursor — the queue and
 * the transport belong to MPD, the server only mirrors them, and the honest answer to "what is
 * playing" is always a fresh read rather than a replay.
 *
 * It exists because the mirrors are change-driven. A client that has fallen behind is usually
 * looking at a queue that has not moved, so there is nothing pending to publish and no amount of
 * waiting will produce one — the client has to be able to ask.
 *
 * `chatId` is optional and names a conversation whose own playlist message should be reconciled at
 * the same time; without it this is purely about session state.
 */
export const ChatRefreshSchema = z.object({
  chatId: z.string().optional(),
});
export type ChatRefresh = z.infer<typeof ChatRefreshSchema>;

/** Raises this session's render ceiling, clamped server-side by `CHAT_VERBOSITY`. */
export const ChatSetVerbositySchema = z.object({
  level: VerbositySchema,
});
export type ChatSetVerbosity = z.infer<typeof ChatSetVerbositySchema>;
