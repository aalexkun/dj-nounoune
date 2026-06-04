import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TechnicalInfo, TechnicalInfoSchema } from './technical-info.schema';

export type SourceType = 'file' | 'spotify' | 'applemusic' | 'youtube' | 'qobuz';

@Schema({ _id: false })
export class Source {
  @Prop({
    type: String,
    required: true,
    enum: ['file', 'spotify', 'applemusic', 'youtube', 'qobuz'],
  })
  name: SourceType;

  @Prop({ type: String, required: false })
  sourceId?: string | null;
}

@Schema({ _id: false })
export class ArtistSource extends Source {}

@Schema({ _id: false })
export class AlbumSource extends Source {}

@Schema({ _id: false })
export class SongSource extends Source {
  @Prop({ type: TechnicalInfoSchema, required: false })
  technical_info?: TechnicalInfo;
}

export const SourceSchema = SchemaFactory.createForClass(Source);
export const ArtistSourceSchema = SchemaFactory.createForClass(ArtistSource);
export const AlbumSourceSchema = SchemaFactory.createForClass(AlbumSource);
export const SongSourceSchema = SchemaFactory.createForClass(SongSource);
