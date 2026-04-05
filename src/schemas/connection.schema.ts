import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ConnectionDocument = Connection & Document;

@Schema()
export class Connection {
  @Prop({ required: true })
  socketId: string;

  @Prop({ required: false })
  userId: string;

  @Prop({ required: true })
  sessionId: string;

  @Prop({ required: true, default: 'active' })
  status: string;

  @Prop()
  deviceName?: string;

  @Prop({ default: Date.now })
  connectedAt: Date;

  @Prop()
  disconnectedAt?: Date;

  @Prop()
  logoutAt?: Date;
}

export const ConnectionSchema = SchemaFactory.createForClass(Connection);
