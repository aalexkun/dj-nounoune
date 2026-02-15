import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type SourceType = 'file' | 'spotify' | 'applemusic' | 'youtube';

@Schema({ _id: false })
export class Source {
  @Prop({
    type: String,
    required: true,
    enum: ['file', 'spotify', 'applemusic', 'youtube'],
  })
  name: SourceType;

  @Prop({ type: String, required: false })
  sourceId?: string | null;
}

export const SourceSchema = SchemaFactory.createForClass(Source);
