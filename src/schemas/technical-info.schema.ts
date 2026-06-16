import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class TechnicalInfo {
  @Prop({ description: 'File size in bytes' })
  size: number;

  @Prop({ description: 'Audio encoding format' })
  encoding: string;

  @Prop({ description: 'Audio bitrate' })
  bitrate: number;

  @Prop({ description: 'Audio sample rate' })
  sample_rate: number;

  @Prop({ index: true, description: 'Whether the audio is high resolution' })
  is_high_res: boolean;

  @Prop({ index: true, description: 'Whether the audio is CD quality' })
  is_cd_quality: boolean;

  @Prop({ description: 'Duration of the audio in seconds' })
  duration: number;

  @Prop({ description: 'Audio bit depth' })
  bit_depth: number;

  @Prop({ description: 'File extension of the audio file' })
  extension: string;

  @Prop({ description: 'Beats per minute of the track' })
  bpm: number;
}

export const TechnicalInfoSchema = SchemaFactory.createForClass(TechnicalInfo);
