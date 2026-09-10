import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Content, Part } from '@google/genai';

export type ChatDocument = HydratedDocument<Chat>;

@Schema({ _id: false })
export class ChatMessage implements Content {
  @Prop({ type: String, description: 'Role of the message author (e.g. user or model)' })
  role?: string;

  @Prop({ type: Array, description: 'Content parts that make up the message' })
  parts?: Part[];
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Chat {
  @Prop({ required: true, index: true, description: 'Identifier of the user owning the chat' })
  userId: string;

  @Prop({ type: [ChatMessageSchema], default: [], description: 'Ordered history of chat messages' })
  history: ChatMessage[];

  @Prop({ type: String, required: true, description: 'Topic of the chat conversation' })
  topic: string;

  /**
   * Allocated with `$inc` so two writers cannot land on the same value. It lives on the chat
   * document rather than in Redis so that it is durable alongside the envelopes the
   * `{ chatId, seq }` unique index protects — a cache flush would restart a Redis counter at one
   * and every allocation after it would collide.
   */
  @Prop({ type: Number, default: 0, description: 'Monotonic counter handing out `seq` to this chat’s envelopes' })
  seqCounter: number;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
