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

/** Backfill request. `sinceSeq` is exclusive: the client passes the highest seq it holds. */
export const ChatResyncSchema = z.object({
  chatId: z.string(),
  sinceSeq: z.number().int().nonnegative().default(0),
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

/** Raises this session's render ceiling, clamped server-side by `CHAT_VERBOSITY`. */
export const ChatSetVerbositySchema = z.object({
  level: VerbositySchema,
});
export type ChatSetVerbosity = z.infer<typeof ChatSetVerbositySchema>;
