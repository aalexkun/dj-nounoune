import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DeduplicationDocument = HydratedDocument<Deduplication>;

@Schema({ _id: false })
export class DuplicateEntry {
  @Prop({ type: Types.ObjectId, ref: 'Song', required: true, description: 'Reference to the duplicate song' })
  songId: Types.ObjectId;

  @Prop({ type: Number, required: true, description: 'Similarity score of the duplicate match' })
  score: number;
}

export const DuplicateEntrySchema = SchemaFactory.createForClass(DuplicateEntry);

@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Deduplication {
  @Prop({ type: [DuplicateEntrySchema], default: [], description: 'List of detected duplicate song entries' })
  duplicates: DuplicateEntry[];

  @Prop({
    type: String,
    enum: ['pending', 'completed', 'error'],
    required: true,
    default: 'pending',
    description: 'Processing status of the deduplication',
  })
  status: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [], description: 'Archived duplicate records that have been resolved' })
  archived: Record<string, unknown>[];

  @Prop({ type: String, required: false, description: 'Error message if the deduplication failed' })
  errorMessage?: string;
}

export const DeduplicationSchema = SchemaFactory.createForClass(Deduplication);

// Index for efficient double-listing lookups
DeduplicationSchema.index({ 'duplicates.songId': 1 });
