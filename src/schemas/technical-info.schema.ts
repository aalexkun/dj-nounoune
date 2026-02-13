import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class TechnicalInfo {
  @Prop()
  size: number;

  @Prop()
  encoding: string;

  @Prop()
  bitrate: number;

  @Prop()
  sample_rate: number;

  @Prop()
  is_hifi: boolean;

  @Prop()
  duration: number;

  @Prop()
  bit_depth: number;

  @Prop()
  extension: string;
}

export const TechnicalInfoSchema = SchemaFactory.createForClass(TechnicalInfo);
