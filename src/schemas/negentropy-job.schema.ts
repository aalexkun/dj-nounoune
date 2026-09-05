import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NegentropyJobDocument = HydratedDocument<NegentropyJob>;

/**
 * Outcome of one round of lookups. `no_match` and `failed` are recorded for the
 * same reason `upgraded` is: the record is what stops the next cycle asking
 * the providers about this song again.
 */
export const NEGENTROPY_JOB_STATUSES = ['upgraded', 'no_match', 'failed'] as const;

export type NegentropyJobStatus = (typeof NEGENTROPY_JOB_STATUSES)[number];

/** The streaming providers the pass can swap a file for. Mirrors `UPGRADE_PROVIDERS` in `quality.util.ts`. */
export const NEGENTROPY_PROVIDERS = ['qobuz', 'spotify', 'youtube'] as const;

export type NegentropyProvider = (typeof NEGENTROPY_PROVIDERS)[number];

/**
 * One song the upgrade pass has already asked the streaming providers about.
 *
 * This collection exists to keep the 20s cycle off the provider APIs: the queue
 * barely changes between passes, so without a record of what has been looked at
 * every cycle would re-search the same upcoming tracks. One document per song,
 * written whether or not a match was found. Delete a document to force that
 * song to be looked at again — which is also the way to re-check a `no_match`
 * recorded while one of the providers was unreachable.
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
    description: 'Reference to the song that was looked up on the streaming providers',
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

  @Prop({
    type: String,
    enum: [...NEGENTROPY_PROVIDERS],
    description: 'Streaming provider the song was upgraded to: qobuz, spotify or youtube',
  })
  provider?: NegentropyProvider;

  @Prop({ description: 'Provider-specific id of the stream the song was upgraded to: a Qobuz track id, a Spotify track id or a YouTube video id' })
  sourceId?: string;

  @Prop({ type: [String], description: 'Providers asked during this lookup, in the order they were asked' })
  providersTried?: string[];

  @Prop({ description: 'Match score of the accepted candidate, 0 to 1' })
  score?: number;

  @Prop({ description: 'Why the song was considered low quality, e.g. "lossy mp3 @ 128kbps"' })
  reason?: string;

  @Prop({ description: 'Error message when the lookup or the queue swap failed' })
  error?: string;

  @Prop({ default: Date.now, description: 'Timestamp of the lookup' })
  processedAt: Date;
}

export const NegentropyJobSchema = SchemaFactory.createForClass(NegentropyJob);
