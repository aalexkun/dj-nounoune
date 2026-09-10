import { z } from 'zod';
import { ChatActionSchema } from './action.schema';
import { ChatPayloadSchema } from './payload.schema';

/** Wire version. Bumped only for a change an old client could not degrade through. */
export const PROTOCOL_VERSION = 1;

export const VerbositySchema = z.enum(['error', 'warn', 'info', 'debug', 'trace']);
export type Verbosity = z.infer<typeof VerbositySchema>;

/**
 * Comparable ranks, so a filter is `rank(level) <= rank(ceiling)` rather than a set membership
 * test that has to be updated whenever a level is added.
 */
export const VERBOSITY_RANK: Record<Verbosity, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

/** Nothing above this is persisted, whatever the server ceiling lets through to the wire. */
export const PERSIST_MAX_VERBOSITY: Verbosity = 'info';

/**
 * One message on the wire, in either direction, live or replayed.
 *
 * The identity rules are the whole design:
 *
 * - **`id` is stable and `rev` monotonic.** The client keeps a map keyed on `id` and applies an
 *   envelope only when `rev` is higher than what it holds. Streaming text, a thought resolving
 *   from "searching" to "found 24 songs", a playlist row changing source under a negentropy swap
 *   and (later) an edited message are all the same operation: republish the whole envelope.
 * - **`seq` orders, `rev` versions.** `seq` is allocated per chat from an atomic counter and is
 *   also the resync cursor; arrival order is not trusted for either.
 * - **`chatId` may be null.** Player state belongs to the session, not to a conversation. A null
 *   `chatId` routes to the session surface — the transport bar, a snackbar — never into a
 *   timeline, and never reaches the `{ chatId, seq }` index.
 * - **`copyText` is always present.** It is the clipboard payload *and* the fallback render for a
 *   payload type the client does not know yet.
 */
export const ChatEnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string(),
  rev: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),

  /** Null → session-scoped: `mpc`, `session_resumed`. Never rendered into a conversation. */
  chatId: z.string().nullable(),
  /** Null → server-originated rather than produced by a user turn: a reconcile, the transport bar. */
  turnId: z.string().nullable(),
  /** Set → this is a child of that envelope. The sub-thread link. */
  parentId: z.string().nullable().default(null),

  /**
   * Echoed back on the user's own message from `chat:send`, so the app's optimistic bubble adopts
   * the server id instead of rendering a second one beside it.
   */
  clientId: z.string().optional(),

  /** Reserved for the edit feature. Always null today; on the wire so adding edit needs no v2. */
  supersededBy: z.string().nullable().default(null),

  role: z.enum(['user', 'assistant', 'agent', 'tool', 'system']),
  state: z.enum(['pending', 'streaming', 'complete', 'failed']).default('complete'),
  level: VerbositySchema.default('info'),

  createdAt: z.number().int(),
  updatedAt: z.number().int(),

  copyText: z.string(),
  actions: z.array(ChatActionSchema).default([]),
  payload: ChatPayloadSchema,
});

export type ChatEnvelope = z.infer<typeof ChatEnvelopeSchema>;
export type ChatRole = ChatEnvelope['role'];
export type ChatState = ChatEnvelope['state'];

/**
 * Whether an envelope is written to `chat_message`.
 *
 * The whole persistence policy, in one predicate. Session-scoped envelopes are live state rather
 * than history — the transport bar is regenerated from Redis on every reconnect — and `debug` and
 * `trace` would otherwise let one debugging session permanently fatten a chat.
 *
 * A `seq` is still allocated for what this rejects; a gap in the sequence is harmless, and it
 * keeps the allocator free of special cases.
 */
export function isPersistable(envelope: Pick<ChatEnvelope, 'chatId' | 'level'>): boolean {
  return envelope.chatId !== null && VERBOSITY_RANK[envelope.level] <= VERBOSITY_RANK[PERSIST_MAX_VERBOSITY];
}

/** Whether `level` passes a ceiling. Used by the server ceiling and by the per-session override. */
export function withinVerbosity(level: Verbosity, ceiling: Verbosity): boolean {
  return VERBOSITY_RANK[level] <= VERBOSITY_RANK[ceiling];
}
