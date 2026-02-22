import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SessionDocument = Session & Document;

@Schema()
export class Session {
  @Prop({ required: true })
  socketId: string;

  @Prop({ required: true, default: 'active' })
  status: string;

  @Prop({ default: Date.now })
  connectedAt: Date;

  @Prop()
  disconnectedAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
