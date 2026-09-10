import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TechnicalInfo, TechnicalInfoSchema } from './technical-info.schema';

/**
 * Every source type the platform supports. This list is exhaustive and stays exhaustive —
 * which of these are currently reachable is a runtime concern driven by `ACTIVE_SOURCE_TYPES`,
 * see `src/config/active-source.util.ts`.
 */
export const SOURCE_TYPES = ['file', 'spotify', 'applemusic', 'youtube', 'qobuz'] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

@Schema({ _id: false })
export class Source {
  @Prop({
    type: String,
    required: true,
    enum: [...SOURCE_TYPES],
    description: 'Name of the playback source provider',
  })
  name: SourceType;

  @Prop({ type: String, required: false, description: 'Provider-specific identifier of the item on this source' })
  sourceId?: string | null;
}

@Schema({ _id: false })
export class ArtistSource extends Source {}

@Schema({ _id: false })
export class AlbumSource extends Source {}

@Schema({ _id: false })
export class SongSource extends Source {
  @Prop({ type: String, required: false, description: 'File path of the track on this source' })
  path?: string;

  @Prop({ type: String, required: true, description: 'Filename of the track on this source' })
  filename: string;

  @Prop({
    type: String,
    required: false,
    description:
      'International Standard Recording Code of the recording on this source, when the provider reports one. Two sources sharing an ISRC are the same recording.',
  })
  isrc?: string;

  @Prop({ type: TechnicalInfoSchema, required: false, description: 'Per-source technical metadata of the track' })
  technical_info?: TechnicalInfo;
}

export const SourceSchema = SchemaFactory.createForClass(Source);
export const ArtistSourceSchema = SchemaFactory.createForClass(ArtistSource);
export const AlbumSourceSchema = SchemaFactory.createForClass(AlbumSource);
export const SongSourceSchema = SchemaFactory.createForClass(SongSource);
