import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DeduplicationDocument = HydratedDocument<Deduplication>;

/**
 * How sure the search was that a candidate is the same recording as the primary.
 *
 * - `auto`: the deterministic scorer is certain (a shared ISRC, or near-identical title, artist and
 *   album with a matching duration). Merged by `music dedup process` without anyone looking.
 * - `review`: plausible but not certain — an edition difference, a small spelling gap, a missing
 *   duration. Held until `music dedup review` (the AI) or a human records a `decision`.
 * - `reject` is never stored: a rejected candidate is simply not a duplicate.
 */
export const DUPLICATE_TIERS = ['auto', 'review'] as const;

export type DuplicateTier = (typeof DUPLICATE_TIERS)[number];

export const DUPLICATE_DECISIONS = ['same', 'different'] as const;

export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

export const DUPLICATE_DECIDERS = ['rule', 'ai', 'human'] as const;

export type DuplicateDecider = (typeof DUPLICATE_DECIDERS)[number];

@Schema({ _id: false })
export class DuplicateEntry {
  @Prop({ type: Types.ObjectId, ref: 'Song', required: true, description: 'Reference to the duplicate song' })
  songId: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    description: 'Confidence that this song is the same recording as the primary, 0 to 1. The primary itself carries 0.',
  })
  score: number;

  @Prop({
    type: String,
    enum: [...DUPLICATE_TIERS],
    description: 'Certainty tier the search assigned: auto is merged as is, review waits for a decision. Absent on the primary entry.',
  })
  tier?: DuplicateTier;

  @Prop({
    type: MongooseSchema.Types.Mixed,
    description: 'Per-signal breakdown behind the score: title, artist and album similarity, version markers, duration delta, ISRC',
  })
  signals?: Record<string, unknown>;

  @Prop({ type: [String], default: [], description: 'Human-readable reasons the scorer gave for the tier, e.g. "album edition differs"' })
  reasons: string[];

  @Prop({
    type: String,
    enum: [...DUPLICATE_DECISIONS],
    description: 'Verdict on a review entry: same (merge it) or different (leave it). Absent until the AI or a human decides.',
  })
  decision?: DuplicateDecision;

  @Prop({ type: String, enum: [...DUPLICATE_DECIDERS], description: 'Who recorded the decision: rule (an auto entry), ai or human' })
  decidedBy?: DuplicateDecider;

  @Prop({ type: String, description: 'The reason the AI gave for its decision, kept so a wrong merge can be traced' })
  decisionReason?: string;

  @Prop({ type: Number, description: 'Confidence the AI attached to its decision, 0 to 1' })
  decisionConfidence?: number;
}

export const DuplicateEntrySchema = SchemaFactory.createForClass(DuplicateEntry);

/**
 * One song and the candidates the search judged to be the same recording.
 *
 * The first entry is the primary — the document every other entry is merged into. The search
 * writes the group once, `dedup review` fills in decisions on the review entries, and
 * `dedup process` merges what is certain or decided `same`. A group stays `pending` while any
 * entry is still waiting on a decision.
 */
@Schema({
  timestamps: true,
  autoCreate: true,
  versionKey: '__v',
})
export class Deduplication {
  @Prop({ type: [DuplicateEntrySchema], default: [], description: 'The primary song first, then every candidate judged auto or review' })
  duplicates: DuplicateEntry[];

  @Prop({
    type: String,
    enum: ['pending', 'completed', 'error'],
    required: true,
    default: 'pending',
    description: 'Processing status of the group: pending until every entry is merged or decided different',
  })
  status: string;

  @Prop({
    type: String,
    enum: [...DUPLICATE_TIERS],
    description: 'Lowest tier among the entries: auto when every candidate can be merged unattended, review when at least one waits for a decision',
  })
  tier?: DuplicateTier;

  @Prop({
    type: [MongooseSchema.Types.Mixed],
    default: [],
    description: 'Snapshot of every song document in the group as it was when the group was written',
  })
  archived: Record<string, unknown>[];

  @Prop({ type: String, required: false, description: 'Error message if the deduplication failed' })
  errorMessage?: string;
}

export const DeduplicationSchema = SchemaFactory.createForClass(Deduplication);

// Index for efficient double-listing lookups
DeduplicationSchema.index({ 'duplicates.songId': 1 });
DeduplicationSchema.index({ status: 1, tier: 1 });
