import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Song } from './song.schema';
import { AlbumSource, AlbumSourceSchema } from './source.schema';

export type AlbumDocument = HydratedDocument<Album>;

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Album {
  @Prop({ required: true, index: true, description: 'Title of the album' })
  title: string;

  @Prop({ type: Types.ObjectId, ref: 'Artist', required: true, description: 'Reference to the album artist' })
  artist: Types.ObjectId; // or Artist if you import the class

  @Prop({ index: true, description: 'Release year of the album' })
  release_year: string;

  @Prop({ description: 'Whether the album has all of its tracks available' })
  is_complete: boolean;

  @Prop({ description: 'Total duration of the album in seconds' })
  total_duration: number;

  @Prop({ description: 'Gain correction value for the album' })
  album_gain: number;

  @Prop({ description: 'Album rating' })
  rating: number;

  @Prop({ description: 'Number of tracks in the album' })
  track_count: number;

  @Prop({ type: [String], description: 'Genres associated with the album' })
  genre: string[];

  @Prop({ description: 'Record label that released the album' })
  record_label: string;

  @Prop({ description: 'Catalogue number of the album release' })
  catalogue_number: string;

  @Prop({ type: [String], description: 'Languages associated with the album' })
  languages: string[];

  @Prop({
    type: {
      small: { type: String },
      thumbnail: { type: String },
      large: { type: String },
      back: { type: String },
    },
    description: 'Album artwork image URLs in various sizes',
  })
  image: {
    small: string;
    thumbnail: string;
    large: string;
    back: string;
  };

  @Prop({ description: 'Original release date of the album' })
  release_date_original: string;

  @Prop({ description: 'Subtitle of the album' })
  subtitle: string;

  @Prop({ description: 'Description of the album' })
  description: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Song' }], description: 'References to the songs belonging to this album' })
  tracks: Song[];

  @Prop({ type: [AlbumSourceSchema], default: [], description: 'List of sources where the album is available' })
  source: AlbumSource[];
}

export const AlbumSchema = SchemaFactory.createForClass(Album);
