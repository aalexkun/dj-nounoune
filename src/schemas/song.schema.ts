import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TechnicalInfo, TechnicalInfoSchema } from './technical-info.schema';
import { Source, SourceSchema } from './source.schema';

export type SongDocument = HydratedDocument<Song>;

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Song {
  @Prop({ type: Types.ObjectId, ref: 'Artist', required: true })
  artist: Types.ObjectId;

  @Prop()
  album_artist: string;

  @Prop({ type: Types.ObjectId, ref: 'Album', required: true })
  album: Types.ObjectId;

  @Prop({ required: true, index: true })
  title: string;

  @Prop()
  composer: string;

  @Prop({ index: true })
  genre: string;

  @Prop({ index: true })
  year: string;

  @Prop()
  track_number: number;

  @Prop()
  disc_number: number;

  @Prop({ index: true })
  bpm: number;

  @Prop({ index: true })
  category: string;

  @Prop({ type: String, required: false })
  path?: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ type: [SourceSchema], default: [] })
  source: Source[];

  @Prop({ type: TechnicalInfoSchema })
  technical_info: TechnicalInfo;
}

export const SongSchema = SchemaFactory.createForClass(Song);
