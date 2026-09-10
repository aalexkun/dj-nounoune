import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Deduplication, DeduplicationDocument, DuplicateEntry, DuplicateTier } from '../../schemas/deduplication.schema';
import { MusicDbService, PopulatedSong } from '../music-db/music-db.service';
import { OpensearchService } from '../opensearch/opensearch.service';
import { MergeService } from '../merge/merge.service';
import { AppService } from '../../app.service';
import { ToolsService } from '../promptus/tools.service';
import { EnrichAgent } from '../promptus/agent/enrich/enrich.agent';
import { DuplicateVerdictEntry, DuplicateVerdictRequest } from '../promptus/agent/enrich/request/duplicate-verdict.request';
import { getErrorMessage } from '../../utils/error.utils';
import { parseArtistForRecall, parseTitle, scoreDuplicate, SongIdentity } from './duplicate-score.util';

export interface DedupSearchOptions {
  /** Report what would be written without writing groups. */
  dryRun?: boolean;
  /** Songs looked up at most. */
  limit?: number;
  /** Only songs created on or after this date. */
  createdAfter?: Date;
}

export interface DedupSearchResult {
  scanned: number;
  /** Songs already sitting in a pending group. */
  skipped: number;
  groups: number;
  autoEntries: number;
  reviewEntries: number;
  rejected: number;
  errors: number;
  actions: string[];
}

export interface DedupReviewOptions {
  dryRun?: boolean;
  /** Pairs sent to the model at most. */
  limit?: number;
  concurrency?: number;
}

export interface DedupReviewResult {
  asked: number;
  same: number;
  different: number;
  failed: number;
  actions: string[];
}

export interface DedupProcessOptions {
  dryRun?: boolean;
}

export interface DedupProcessResult {
  groups: number;
  merged: number;
  leftDifferent: number;
  waiting: number;
  completed: number;
  errors: number;
  actions: string[];
}

/** Candidates recalled per song. The scorer drops most of them; twenty covers a boxset. */
const RECALL_SIZE = 20;

/** Review pairs sent to the model in parallel. */
const REVIEW_CONCURRENCY = 5;

/** Below this the model's own "same" is not trusted enough to merge unattended. */
const AI_MERGE_CONFIDENCE = 0.7;

/**
 * Deduplication in three passes, each its own CLI subcommand.
 *
 * - **search** recalls candidates from OpenSearch, scores every pair in code
 *   (`duplicate-score.util.ts`) and writes a group per song holding its `auto` and `review`
 *   candidates. Rejected pairs are logged and forgotten.
 * - **review** hands each undecided `review` pair to the model and records its verdict on the
 *   entry, never merging anything itself.
 * - **process** merges what is certain — `auto` entries and entries decided `same` — through
 *   `MergeService`, leaves entries decided `different` alone, and completes a group only once
 *   nothing in it is still waiting.
 *
 * The bias throughout is "better no merge than a wrong merge": the scorer's floors, the model's
 * instruction and the merge cascade guard all err towards leaving two documents in place.
 */
@Injectable()
export class DeduplicationService {
  private readonly logger = new Logger(DeduplicationService.name);
  private readonly enrichAgent: EnrichAgent;

  constructor(
    @InjectModel(Song.name) private readonly songModel: Model<SongDocument>,
    @InjectModel(Deduplication.name) private readonly deduplicationModel: Model<DeduplicationDocument>,
    private readonly musicDbService: MusicDbService,
    private readonly opensearchService: OpensearchService,
    private readonly mergeService: MergeService,
    appService: AppService,
    toolsService: ToolsService,
    eventEmitter: EventEmitter2,
  ) {
    // Same ownership as EnrichService: plain-`new`ed, never exposed as a tool, its own throttle.
    this.enrichAgent = new EnrichAgent(appService.getGenAiApiKey(), toolsService, eventEmitter);
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                             */
  /* ------------------------------------------------------------------ */

  async search(options: DedupSearchOptions = {}): Promise<DedupSearchResult> {
    const dryRun = options.dryRun ?? false;
    const result: DedupSearchResult = { scanned: 0, skipped: 0, groups: 0, autoEntries: 0, reviewEntries: 0, rejected: 0, errors: 0, actions: [] };

    const filter: Record<string, unknown> = {};

    if (options.createdAfter) {
      filter.createdAt = { $gte: options.createdAfter };
    }

    const cursor = this.songModel.find(filter).sort({ _id: 1 }).populate('artist').populate('album').cursor();

    for await (const raw of cursor) {
      if (options.limit !== undefined && result.scanned >= options.limit) break;

      const song = raw as unknown as PopulatedSong;
      const songId = song._id.toString();

      try {
        // Only a *pending* group holds a song back. A song that survived a completed group is
        // the primary of that merge, and a later import can well give it a new duplicate.
        if (await this.isPending(song._id)) {
          result.skipped++;
          continue;
        }

        result.scanned++;

        const identity = this.toIdentity(song);
        const candidates = await this.recall(identity);

        if (candidates.length === 0) continue;

        const entries: DuplicateEntry[] = [];
        const label = `"${identity.artist} - ${identity.album} - ${identity.title}"`;

        for (const candidate of candidates) {
          const verdict = scoreDuplicate(identity, this.toIdentity(candidate));
          const candidateLabel = `"${candidate.artist?.artist ?? ''} - ${candidate.album?.title ?? ''} - ${candidate.title}"`;

          if (verdict.tier === 'reject') {
            result.rejected++;
            this.logger.debug(`  rejected ${candidateLabel} for ${label}: ${verdict.reasons.join('; ')}`);
            continue;
          }

          if (await this.isPending(candidate._id)) {
            this.logger.debug(`  ${candidateLabel} already waits in another group`);
            continue;
          }

          entries.push({
            songId: candidate._id,
            score: Number(verdict.confidence.toFixed(3)),
            tier: verdict.tier,
            signals: { ...verdict.signals },
            reasons: verdict.reasons,
            ...(verdict.tier === 'auto' ? { decision: 'same' as const, decidedBy: 'rule' as const } : {}),
          });

          result.actions.push(
            `${verdict.tier.padEnd(6)} ${verdict.confidence.toFixed(2)}  ${label} ⇐ ${candidateLabel}  (${verdict.reasons.join('; ')})`,
          );
        }

        if (entries.length === 0) continue;

        const tier: DuplicateTier = entries.every((entry) => entry.tier === 'auto') ? 'auto' : 'review';
        result.autoEntries += entries.filter((entry) => entry.tier === 'auto').length;
        result.reviewEntries += entries.filter((entry) => entry.tier === 'review').length;
        result.groups++;

        if (dryRun) continue;

        const ids = [song._id, ...entries.map((entry) => entry.songId)];
        const archived = await this.songModel
          .find({ _id: { $in: ids } })
          .lean()
          .exec();

        await this.deduplicationModel.create({
          duplicates: [{ songId: song._id, score: 0, reasons: [] }, ...entries],
          status: 'pending',
          tier,
          // Plain records already: `.lean()` hands back snapshots, not live documents.
          archived: archived.map((doc) => ({ ...doc })),
        });
      } catch (error: unknown) {
        result.errors++;
        this.logger.error(`Error processing song ${songId}: ${getErrorMessage(error)}`);
      }
    }

    return result;
  }

  private async isPending(songId: Types.ObjectId): Promise<boolean> {
    return (await this.deduplicationModel.exists({ status: 'pending', 'duplicates.songId': songId })) !== null;
  }

  /** Everything OpenSearch thinks might be the same recording, as populated documents. */
  private async recall(identity: SongIdentity): Promise<PopulatedSong[]> {
    const response = await this.opensearchService.findDuplicateCandidates({
      songId: identity.id,
      title: parseTitle(identity.title).core,
      artist: parseArtistForRecall(identity.artist),
      rawTitle: identity.title,
      rawArtist: identity.artist,
      albumId: identity.albumId,
      isrcs: identity.isrcs,
      size: RECALL_SIZE,
    });

    const ids = (response?.hits.hits ?? []).map((hit) => hit._id).filter((id) => id !== identity.id);

    if (ids.length === 0) return [];

    return this.musicDbService.getPopulatedSongsByIds(ids);
  }

  /** What the scorer and the model see of a song. */
  private toIdentity(song: PopulatedSong): SongIdentity {
    const sources = song.source ?? [];
    const durations = sources.map((source) => source.technical_info?.duration ?? 0).filter((duration) => duration > 0);

    return {
      id: song._id.toString(),
      title: song.title ?? '',
      artist: song.artist?.artist ?? '',
      albumArtist: song.album_artist || undefined,
      album: song.album?.title ?? '',
      artistId: song.artist?._id?.toString(),
      albumId: song.album?._id?.toString(),
      duration: durations.length > 0 ? durations[0] : undefined,
      isrcs: sources.map((source) => source.isrc ?? '').filter((isrc) => !!isrc),
      trackNumber: song.track_number || undefined,
      discNumber: song.disc_number || undefined,
      year: song.year || undefined,
    };
  }

  private toVerdictEntry(song: PopulatedSong): DuplicateVerdictEntry {
    const identity = this.toIdentity(song);

    return {
      ...identity,
      sources: (song.source ?? []).map((source) => source.name),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Review                                                             */
  /* ------------------------------------------------------------------ */

  async review(options: DedupReviewOptions = {}): Promise<DedupReviewResult> {
    const dryRun = options.dryRun ?? false;
    const result: DedupReviewResult = { asked: 0, same: 0, different: 0, failed: 0, actions: [] };

    const groups = await this.deduplicationModel.find({ status: 'pending', tier: 'review' }).sort({ _id: 1 }).exec();

    // Every undecided review pair, capped, then the songs behind them in one read.
    const pairs: { group: DeduplicationDocument; entry: DuplicateEntry }[] = [];

    for (const group of groups) {
      for (const entry of group.duplicates.slice(1)) {
        if (entry.tier === 'review' && !entry.decision) {
          pairs.push({ group, entry });
        }
      }
    }

    const selected = options.limit !== undefined ? pairs.slice(0, options.limit) : pairs;

    if (selected.length === 0) return result;

    const ids = [...new Set(selected.flatMap((pair) => [pair.group.duplicates[0].songId.toString(), pair.entry.songId.toString()]))];
    const songs = new Map((await this.musicDbService.getPopulatedSongsByIds(ids)).map((song) => [song._id.toString(), song]));

    const askable = selected.filter((pair) => songs.has(pair.group.duplicates[0].songId.toString()) && songs.has(pair.entry.songId.toString()));
    const requests = askable.map(
      (pair) =>
        new DuplicateVerdictRequest(
          this.toVerdictEntry(songs.get(pair.group.duplicates[0].songId.toString())!),
          this.toVerdictEntry(songs.get(pair.entry.songId.toString())!),
          pair.entry.signals ?? {},
          pair.entry.reasons ?? [],
        ),
    );

    result.asked = requests.length;

    const responses = await this.enrichAgent.parallelGenerate(requests, options.concurrency ?? REVIEW_CONCURRENCY);

    for (const [index, pair] of askable.entries()) {
      const response = responses[index];
      const primary = songs.get(pair.group.duplicates[0].songId.toString())!;
      const candidate = songs.get(pair.entry.songId.toString())!;
      const label = `"${primary.artist?.artist} - ${primary.title}" vs "${candidate.artist?.artist} - ${candidate.album?.title} - ${candidate.title}"`;

      // A failed request leaves a hole; the pair stays undecided and the next run retries it.
      if (!response) {
        result.failed++;
        result.actions.push(`failed   ${label}`);
        continue;
      }

      const decision = response.same && response.confidence >= AI_MERGE_CONFIDENCE ? 'same' : 'different';

      if (decision === 'same') result.same++;
      else result.different++;

      result.actions.push(`${decision.padEnd(9)} ${response.confidence.toFixed(2)}  ${label}  — ${response.reason}`);

      if (dryRun) continue;

      await this.deduplicationModel
        .updateOne(
          { _id: pair.group._id },
          {
            $set: {
              'duplicates.$[entry].decision': decision,
              'duplicates.$[entry].decidedBy': 'ai',
              'duplicates.$[entry].decisionReason': response.reason,
              'duplicates.$[entry].decisionConfidence': response.confidence,
            },
          },
          { arrayFilters: [{ 'entry.songId': pair.entry.songId }] },
        )
        .exec();
    }

    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Process                                                            */
  /* ------------------------------------------------------------------ */

  async process(options: DedupProcessOptions = {}): Promise<DedupProcessResult> {
    const dryRun = options.dryRun ?? false;
    const result: DedupProcessResult = { groups: 0, merged: 0, leftDifferent: 0, waiting: 0, completed: 0, errors: 0, actions: [] };

    const groups = await this.deduplicationModel.find({ status: 'pending' }).sort({ _id: 1 }).exec();

    for (const group of groups) {
      const groupId = group._id.toString();

      if (group.duplicates.length < 2) {
        this.logger.warn(`Dedup group ${groupId} has fewer than 2 entries — skipping.`);
        continue;
      }

      result.groups++;

      const primaryId = group.duplicates[0].songId.toString();
      let waiting = 0;

      try {
        for (const entry of group.duplicates.slice(1)) {
          const duplicateId = entry.songId.toString();
          // An entry with no tier predates the tiers: the old search only ever wrote what it
          // considered certain, so it is read as auto rather than left waiting forever.
          const mergeable = entry.tier === 'auto' || entry.tier === undefined || entry.decision === 'same';

          if (entry.decision === 'different') {
            result.leftDifferent++;
            continue;
          }

          if (!mergeable) {
            waiting++;
            continue;
          }

          const why =
            entry.decidedBy === 'ai'
              ? `ai ${entry.decisionConfidence?.toFixed(2) ?? ''}: ${entry.decisionReason ?? ''}`
              : entry.tier === undefined
                ? `legacy group, score ${entry.score.toFixed(0)}`
                : `auto ${entry.score.toFixed(2)}`;

          if (dryRun) {
            result.actions.push(`[dry-run] would merge ${duplicateId} into ${primaryId} (${why})`);
            result.merged++;
            continue;
          }

          await this.mergeService.mergeDuplicateTracks(primaryId, duplicateId);
          result.merged++;
          result.actions.push(`merged ${duplicateId} into ${primaryId} (${why})`);
        }

        if (waiting > 0) {
          result.waiting += waiting;
          result.actions.push(`group ${groupId}: ${waiting} entr${waiting === 1 ? 'y' : 'ies'} still waiting for a review decision`);
          continue;
        }

        result.completed++;

        if (!dryRun) {
          await this.deduplicationModel.updateOne({ _id: group._id }, { $set: { status: 'completed' } }).exec();
        }
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        result.errors++;
        result.actions.push(`error on group ${groupId}: ${message}`);
        this.logger.error(`Failed to process dedup ${groupId}: ${message}`);

        if (!dryRun) {
          await this.deduplicationModel.updateOne({ _id: group._id }, { $set: { status: 'error', errorMessage: message } }).exec();
        }
      }
    }

    return result;
  }
}
