import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PlaylogDocument = HydratedDocument<Playlog>;

@Schema({ _id: false })
export class PlaylogFeedback {
  @Prop({ type: Number, default: 0, description: 'Count of "awesome" listener reactions' })
  awesome: number;

  @Prop({ type: Number, default: 0, description: 'Count of "wtf" listener reactions' })
  wtf: number;

  @Prop({ type: Number, default: 0, description: 'Count of "great" listener reactions' })
  great: number;

  @Prop({ type: Number, default: 0, description: 'Count of "duh" listener reactions' })
  duh: number;
}

export const PlaylogFeedbackSchema = SchemaFactory.createForClass(PlaylogFeedback);

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Playlog {
  @Prop({ default: Date.now, description: 'Timestamp when the track was played' })
  playedAt: Date;

  @Prop({ required: true, description: 'Raw MPD server current request reply' })
  raw: string;

  @Prop({ description: 'text title of the played track' })
  title?: string;

  @Prop({ description: 'id reference artist of the played track' })
  artist?: Types.ObjectId;

  @Prop({ description: 'id reference album of the played track' })
  album?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Song', required: true, description: 'Reference to the played song' })
  songId: Types.ObjectId;

  @Prop({
    type: PlaylogFeedbackSchema,
    default: () => ({ awesome: 0, wtf: 0, great: 0, duh: 0 }),
    description: 'Aggregated listener feedback reactions for this play',
  })
  feedback: PlaylogFeedback;

  @Prop({ description: 'Identifier of the playlist request that triggered this play' })
  playlistRequestId?: string;

  @Prop({ description: 'Album artwork URL shown on the public now-playing page' })
  coverUrl?: string;

  @Prop({ description: 'Disc jockey commentary about the played track, in markdown' })
  description?: string;
}

export const PlaylogSchema = SchemaFactory.createForClass(Playlog);
