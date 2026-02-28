import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Song } from './song.schema';

export type AlbumDocument = HydratedDocument<Album>;

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Album {
  @Prop({ required: true, index: true })
  title: string;

  @Prop({ type: Types.ObjectId, ref: 'Artist', required: true })
  artist: Types.ObjectId; // or Artist if you import the class

  @Prop({ index: true })
  release_year: string;

  @Prop()
  is_complete: boolean;

  @Prop()
  total_duration: number;

  @Prop()
  album_gain: number;

  @Prop()
  rating: number;

  @Prop()
  track_count: number;

  @Prop([String])
  genre: string[];

  @Prop()
  record_label: string;

  @Prop()
  catalogue_number: string;

  @Prop([String])
  languages: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Song' }] })
  tracks: Song[];
}

export const AlbumSchema = SchemaFactory.createForClass(Album);
