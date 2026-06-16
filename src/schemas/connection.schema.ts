import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ConnectionDocument = Connection & Document;

@Schema()
export class Connection {
  @Prop({ required: true, description: 'Socket identifier of the connection' })
  socketId: string;

  @Prop({ required: false, description: 'Identifier of the connected user' })
  userId: string;

  @Prop({ required: true, description: 'Session identifier of the connection' })
  sessionId: string;

  @Prop({ required: true, default: 'active', description: 'Current status of the connection' })
  status: string;

  @Prop({ description: 'Name of the connected device' })
  deviceName?: string;

  @Prop({ default: Date.now, description: 'Timestamp when the connection was established' })
  connectedAt: Date;

  @Prop({ description: 'Timestamp when the connection was disconnected' })
  disconnectedAt?: Date;

  @Prop({ description: 'Timestamp when the user logged out' })
  logoutAt?: Date;
}

export const ConnectionSchema = SchemaFactory.createForClass(Connection);
