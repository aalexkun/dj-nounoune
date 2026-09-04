import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SongSource, SongSourceSchema } from './source.schema';

export type SongDocument = HydratedDocument<Song>;

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Song {
  @Prop({ type: Types.ObjectId, ref: 'Artist', required: true, description: 'Reference to the Artist that performed the song' })
  artist: Types.ObjectId;

  @Prop({ description: 'Name of the album artist' })
  album_artist: string;

  @Prop({ type: Types.ObjectId, ref: 'Album', required: true, description: 'Reference to the Album the song belongs to' })
  album: Types.ObjectId;

  @Prop({ required: true, index: true, description: 'Title of the track' })
  title: string;

  @Prop({ description: 'Composer of the track' })
  composer: string;

  @Prop({ index: true, description: 'Musical genre of the track' })
  genre: string;

  @Prop({ index: true, description: 'Release year of the track' })
  year: string;

  @Prop({ description: 'Position of the track within its disc' })
  track_number: number;

  @Prop({ description: 'Disc number the track belongs to' })
  disc_number: number;

  @Prop({ index: true, description: 'High-level category of the track (like genre but with less segmentation)' })
  category: string;

  @Prop({ description: 'Language of the song' })
  language?: string;

  @Prop({ description: 'Country of origin' })
  country?: string;

  @Prop({ description: 'Emotion of the song' })
  emotion?: string;

  @Prop({ description: 'Pace of the song' })
  pace?: string;

  @Prop({
    description:
      'One-sentence third-person distillation of what the song is about, derived from its lyrics. ' +
      'Served by the semantic search branch only — never a filter field.',
  })
  lyric_semantic?: string;

  @Prop({ type: [SongSourceSchema], default: [], description: 'List of playback sources where the track is available' })
  source: SongSource[];

  @Prop({ type: String, enum: ['file', 'qobuz', 'spotify', 'youtube'], required: false, description: 'Source system that created the song record' })
  created_by?: string;
}

export const SongSchema = SchemaFactory.createForClass(Song);
