import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DeduplicationDocument = HydratedDocument<Deduplication>;

@Schema({ _id: false })
export class DuplicateEntry {
  @Prop({ type: Types.ObjectId, ref: 'Song', required: true })
  songId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  score: number;
}

export const DuplicateEntrySchema = SchemaFactory.createForClass(DuplicateEntry);

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Deduplication {
  @Prop({ type: [DuplicateEntrySchema], default: [] })
  duplicates: DuplicateEntry[];

  @Prop({
    type: String,
    enum: ['pending', 'completed', 'error'],
    required: true,
    default: 'pending',
  })
  status: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  archived: Record<string, any>[];

  @Prop({ type: String, required: false })
  errorMessage?: string;
}

export const DeduplicationSchema = SchemaFactory.createForClass(Deduplication);

// Index for efficient double-listing lookups
DeduplicationSchema.index({ 'duplicates.songId': 1 });
