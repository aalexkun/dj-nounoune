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
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
