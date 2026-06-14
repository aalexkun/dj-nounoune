import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PlaylogDocument = HydratedDocument<Playlog>;

@Schema({ _id: false })
export class PlaylogFeedback {
  @Prop({ type: Number, default: 0 })
  awesome: number;

  @Prop({ type: Number, default: 0 })
  wtf: number;

  @Prop({ type: Number, default: 0 })
  great: number;

  @Prop({ type: Number, default: 0 })
  duh: number;
}

export const PlaylogFeedbackSchema = SchemaFactory.createForClass(PlaylogFeedback);

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Playlog {
  @Prop({ default: Date.now })
  playedAt: Date;

  @Prop({ required: true })
  raw: string;

  @Prop()
  title?: string;

  @Prop()
  artist?: string;

  @Prop()
  album?: string;

  @Prop({ type: Types.ObjectId, ref: 'Song', required: true })
  songId: Types.ObjectId;

  @Prop({ type: PlaylogFeedbackSchema, default: () => ({ awesome: 0, wtf: 0, great: 0, duh: 0 }) })
  feedback: PlaylogFeedback;

  @Prop()
  playlistRequestId?: string;
}

export const PlaylogSchema = SchemaFactory.createForClass(Playlog);
