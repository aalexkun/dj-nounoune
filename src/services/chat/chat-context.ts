import { randomBytes } from 'node:crypto';
import { SessionId } from '../session/session.service';

/**
 * Who an envelope is for and where it sits.
 *
 * This is the widened `sessionId` that used to be threaded from the gateway down through
 * `Agent.generate`, `ToolsService.proceedFunctionCall` and `ToolHandler.execute`. Widening the
 * parameter in place rather than keeping a per-session "current turn" stack costs six handler
 * edits — only six of roughly twenty-five read the parameter at all — and buys the one thing a
 * stack cannot give: correctness under `parallelGenerate`, where several requests are in flight
 * against the same agent instance.
 *
 * `chatId` and `turnId` are nullable because not everything belongs to a conversation. Player
 * state belongs to the connection; a queue reconciliation belongs to no user turn. A null
 * `chatId` routes to the session surface — the transport bar, a snackbar — and is never persisted.
 */
export type ChatContext = {
  sessionId: SessionId;
  chatId: string | null;
  turnId: string | null;
  /** Set → envelopes emitted with this context are children of that envelope. */
  parentId?: string;
};

/**
 * A time-ordered, collision-resistant id.
 *
 * Lexicographically sortable by creation time, which makes a log listing readable, but nothing
 * depends on that: ordering on the wire is `seq`, allocated from an atomic counter. This only has
 * to be unique. Hand-rolled rather than pulling in `ulid` — `.npmrc` sets a seven-day
 * `min-release-age` and every install script is allow-listed by hand, so a dependency for
 * sixteen bytes of randomness is not worth the supply-chain surface.
 */
export function newId(): string {
  return `${Date.now().toString(36).padStart(9, '0')}${randomBytes(10).toString('hex')}`;
}

/** A context whose envelopes hang off `parentId`. What `openThread` hands back. */
export function childContext(ctx: ChatContext, parentId: string): ChatContext {
  return { ...ctx, parentId };
}

/** A session-scoped context: the transport bar, connection events. Never persisted. */
export function sessionContext(sessionId: SessionId): ChatContext {
  return { sessionId, chatId: null, turnId: null };
}
