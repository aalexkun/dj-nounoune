import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LightingMemoryDocument = HydratedDocument<LightingMemory>;

/** One lighting request as it happened, kept so the summariser can see corrections in sequence. */
@Schema({ _id: false })
export class LightingMemoryEntry {
  @Prop({ required: true, description: 'When the request was made' })
  at: Date;

  @Prop({ required: true, description: 'What the user asked for, verbatim' })
  request: string;

  @Prop({ type: [String], default: [], description: 'The tool calls the agent made, one line each' })
  actions: string[];

  @Prop({ description: 'What the agent answered, trimmed' })
  reply?: string;
}

export const LightingMemoryEntrySchema = SchemaFactory.createForClass(LightingMemoryEntry);

/**
 * What the lighting designer has learnt about this household.
 *
 * One document for the whole house rather than one per user: the lamps are shared, and "too
 * bright" said by anyone is a fact about the room. `summary` is written by a model after each
 * request — stable preferences, corrections, the words people use for things — and handed back
 * to the designer at the start of the next one. `recent` is the raw tail the summariser reads so
 * it can tell a correction ("no, only the bedroom") from a new request.
 */
@Schema({
  timestamps: true,
  autoCreate: true,
  collection: 'lighting_memory',
  versionKey: '__v',
})
export class LightingMemory {
  @Prop({ required: true, unique: true, description: 'Scope of the memory; only "household" exists today' })
  scope: string;

  @Prop({ default: '', description: 'Model-written digest of preferences, corrections and vocabulary, bounded in length' })
  summary: string;

  @Prop({ type: [LightingMemoryEntrySchema], default: [], description: 'The most recent requests, oldest first, capped' })
  recent: LightingMemoryEntry[];

  @Prop({ default: 0, description: 'How many requests have been folded into the summary over its life' })
  requests: number;
}

export const LightingMemorySchema = SchemaFactory.createForClass(LightingMemory);
