import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type EnrichDocument = Enrich & Document;

@Schema({ _id: false })
export class EnrichStatus {
  @Prop({ type: String, enum: ['completed', 'queued', 'notApplicable'], default: 'queued' })
  ai: string;

  @Prop({ type: String, enum: ['completed', 'queued', 'notApplicable'], default: 'queued' })
  bpm: string;

  @Prop({ type: String, enum: ['completed', 'queued', 'notApplicable'], default: 'queued' })
  ffprobe: string;

  @Prop({ type: String, enum: ['completed', 'queued', 'notApplicable'], default: 'queued' })
  lyric_semantic: string;
}

const EnrichStatusSchema = SchemaFactory.createForClass(EnrichStatus);

@Schema({ timestamps: true })
export class Enrich {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Song', required: true })
  _id: string;

  @Prop({ type: EnrichStatusSchema, default: () => ({}) })
  status: EnrichStatus;

  @Prop({ type: String })
  message: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  response: any;
}

export const EnrichSchema = SchemaFactory.createForClass(Enrich);
