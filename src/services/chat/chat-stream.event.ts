import { ChatEnvelope } from './protocol';
import { SessionId } from '../session/session.service';

/**
 * The single event name every part of the app pushes chat output onto.
 *
 * One name, not one per kind — the type lives on the payload, and a single name is what lets
 * `ChatStreamService` bridge the whole bus into one stream with one `fromEventPattern`.
 *
 * Going through the Nest emitter rather than injecting `ChatStreamService` everywhere is
 * deliberate: it keeps the decoupling the codebase already depends on. `ToolsService.initialiseAgent`
 * exists precisely because agents need tools and tools need agents, and the emitter is what breaks
 * that cycle. A queue reconciler or a negentropy pass emitting into chat should not have to be
 * wired into the chat module to do it.
 */
export const ChatEnvelopeEventName = 'chat.envelope';

export class ChatEnvelopeEvent {
  constructor(
    /** Which connection this is for. Not part of the wire protocol — routing only. */
    public readonly sessionId: SessionId,
    public readonly envelope: ChatEnvelope,
  ) {}
}

/** What the gateway subscribes to: an envelope and the room to put it in. */
export type ChatDelivery = {
  sessionId: SessionId;
  envelope: ChatEnvelope;
};
