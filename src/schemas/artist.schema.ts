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
  @Prop({ required: true, index: true })
  artist: string;

  @Prop([String])
  primary_genres: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Album' }] })
  albums: Types.ObjectId[];

  @Prop()
  short_intro: string;

  @Prop()
  biography: string;

  @Prop({ type: [ArtistSourceSchema], default: [] })
  source: ArtistSource[];
}

export const ArtistSchema = SchemaFactory.createForClass(Artist);
