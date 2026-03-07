import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { Content, Part } from '@google/genai';

export type ChatDocument = HydratedDocument<Chat>;

@Schema({ _id: false })
export class ChatMessage implements Content {
  @Prop({ type: String })
  role?: string;

  @Prop({ type: Array })
  parts?: Part[];
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Chat {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ type: [ChatMessageSchema], default: [] })
  history: ChatMessage[];

  @Prop({ type: String, required: true })
  topic: string;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
