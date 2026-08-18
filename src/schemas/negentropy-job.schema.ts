import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NegentropyJobDocument = HydratedDocument<NegentropyJob>;

/**
 * Outcome of one Qobuz lookup. `no_match` and `failed` are recorded for the
 * same reason `upgraded` is: the record is what stops the next cycle asking
 * Qobuz about this song again.
 */
export const NEGENTROPY_JOB_STATUSES = ['upgraded', 'no_match', 'failed'] as const;

export type NegentropyJobStatus = (typeof NEGENTROPY_JOB_STATUSES)[number];

/**
 * One song the upgrade pass has already asked Qobuz about.
 *
 * This collection exists to keep the 20s cycle off the Qobuz API: the queue
 * barely changes between passes, so without a record of what has been looked at
 * every cycle would re-search the same upcoming tracks. One document per song,
 * written whether or not a match was found. Delete a document to force that
 * song to be looked at again.
 */
@Schema({
  timestamps: true,
  autoCreate: true,
  collection: 'negentropy_job',
  versionKey: '__v',
})
export class NegentropyJob {
  @Prop({
    type: Types.ObjectId,
    ref: 'Song',
    required: true,
    unique: true,
    description: 'Reference to the song that was looked up on Qobuz',
  })
  songId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: [...NEGENTROPY_JOB_STATUSES],
    description: 'Outcome of the lookup: upgraded, no_match or failed',
  })
  status: NegentropyJobStatus;

  @Prop({ description: 'Title of the song at the time of the lookup, for readability' })
  title?: string;

  @Prop({ description: 'Artist name at the time of the lookup, for readability' })
  artist?: string;

  @Prop({ description: 'Album title at the time of the lookup, for readability' })
  album?: string;

  @Prop({ description: 'Qobuz track id the song was upgraded to' })
  qobuzTrackId?: string;

  @Prop({ description: 'Match score of the accepted Qobuz candidate, 0 to 1' })
  score?: number;

  @Prop({ description: 'Why the song was considered low quality, e.g. "lossy mp3"' })
  reason?: string;

  @Prop({ description: 'Error message when the lookup or the queue swap failed' })
  error?: string;

  @Prop({ default: Date.now, description: 'Timestamp of the lookup' })
  processedAt: Date;
}

export const NegentropyJobSchema = SchemaFactory.createForClass(NegentropyJob);
