import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ArtistSource, ArtistSourceSchema } from './source.schema';

export type ArtistDocument = HydratedDocument<Artist>;

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Artist {
  @Prop({ required: true, index: true, description: 'Name of the artist' })
  artist: string;

  @Prop({ type: [String], description: 'Primary genres associated with the artist' })
  primary_genres: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Album' }], description: 'References to the albums by this artist' })
  albums: Types.ObjectId[];

  @Prop({ description: 'Short introduction of the artist' })
  short_intro: string;

  @Prop({ description: 'Full biography of the artist' })
  biography: string;

  @Prop({ type: [ArtistSourceSchema], default: [], description: 'List of sources where the artist is available' })
  source: ArtistSource[];
}

export const ArtistSchema = SchemaFactory.createForClass(Artist);
