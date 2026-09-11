import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { ChatAction, ChatPayload, ChatRole, ChatState, Verbosity } from '../services/chat/protocol';

export type ChatEnvelopeDocument = HydratedDocument<ChatEnvelopeDoc>;

/**
 * The durable log the socket is a projection of.
 *
 * Deliberately **not** `Chat.history`, which stays Gemini `Content[]` — the model's transcript,
 * owned by the agent loop, shaped by what the API needs. This is the presentation timeline, and
 * keeping them apart is what lets `GET /chatroom/:id/messages` hand the app the byte-identical
 * shape the socket emits, instead of the two divergent mappings the client used to maintain.
 *
 * It is also the buffer behind a disconnect: nothing is held in memory while a client is away,
 * because everything worth redelivering is already here.
 *
 * Named `ChatEnvelopeDoc` rather than `ChatMessage` because that name is taken — by the Mongoose
 * class in `chat.schema.ts` that implements Gemini's `Content`.
 */
@Schema({
  collection: 'chat_message',
  timestamps: true,
  autoCreate: true,
  versionKey: false,
})
export class ChatEnvelopeDoc {
  @Prop({ required: true, unique: true, index: true, description: 'Stable envelope identity; the client upserts on it' })
  envelopeId: string;

  @Prop({ required: true, description: 'Bumped on every change to the same envelope; the client applies only a higher rev' })
  rev: number;

  @Prop({ required: true, description: 'Monotonic order within the chat, and the resync cursor' })
  seq: number;

  @Prop({ required: true, index: true, description: 'Chat this envelope belongs to' })
  chatId: string;

  @Prop({ type: String, default: null, description: 'User turn that produced it, or null when server-originated' })
  turnId: string | null;

  @Prop({ type: String, default: null, description: 'Parent envelope, which is what nests a sub-thread' })
  parentId: string | null;

  @Prop({ type: String, description: "Client-minted id echoed back on the user's own message" })
  clientId?: string;

  @Prop({ type: String, default: null, description: 'Reserved for the edit feature; always null today' })
  supersededBy: string | null;

  @Prop({ required: true, description: 'Who is speaking: user, assistant, agent, tool or system' })
  role: ChatRole;

  @Prop({ required: true, description: 'pending, streaming, complete or failed' })
  state: ChatState;

  @Prop({ required: true, description: 'Verbosity level; debug and trace are never stored' })
  level: Verbosity;

  @Prop({ required: true, description: 'Epoch ms the envelope was first created' })
  sentAt: number;

  @Prop({ required: true, description: 'Epoch ms of the most recent revision' })
  revisedAt: number;

  @Prop({ required: true, description: 'Plain-text rendering: the clipboard payload and the unknown-type fallback' })
  copyText: string;

  @Prop({ type: Array, default: [], description: 'Actions the server declares on this message' })
  actions: ChatAction[];

  @Prop({ type: Object, required: true, description: 'The typed payload, discriminated on its own `type`' })
  payload: ChatPayload;

  /**
   * Which connection produced it. Routing metadata, not part of the wire protocol — kept so a
   * later revision of an envelope can be pushed back to the session that originated it rather
   * than broadcast to every live one.
   */
  @Prop({ type: String, description: 'Session that produced the envelope; routing only' })
  sessionId?: string;
}

export const ChatEnvelopeSchemaDefinition = SchemaFactory.createForClass(ChatEnvelopeDoc);

/**
 * The resync query and the ordering guarantee in one index.
 *
 * Unique because a `seq` is allocated from an atomic counter and two envelopes sharing one would
 * mean the counter broke. Nothing with a null `chatId` ever reaches here — session-scoped
 * envelopes are not persisted — so the index needs no partial filter.
 */
ChatEnvelopeSchemaDefinition.index({ chatId: 1, seq: 1 }, { unique: true });

/**
 * The other half of the resync query: what changed, as opposed to what is new.
 *
 * Not unique — a queue reconcile revises several envelopes within the same millisecond, and that is
 * normal rather than a broken counter.
 */
ChatEnvelopeSchemaDefinition.index({ chatId: 1, revisedAt: 1 });
