import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ArtistDocument = HydratedDocument<Artist>;

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Artist {
  @Prop({ required: true })
  artist: string;

  @Prop([String])
  primary_genres: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Album' }] })
  albums: Types.ObjectId[];

  @Prop()
  short_intro: string;

  @Prop()
  biography: string;
}

export const ArtistSchema = SchemaFactory.createForClass(Artist);
