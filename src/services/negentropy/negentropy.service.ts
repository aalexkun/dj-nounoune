import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { NegentropyJob, NegentropyJobDocument, NegentropyJobStatus } from '../../schemas/negentropy-job.schema';
import { SongDocument } from '../../schemas/song.schema';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { PlaylistMpdRequest } from '../mpd-client/requests/PlaylistMpdRequest';
import { StatusMpdRequest } from '../mpd-client/requests/StatusMpdRequest';
import { AddMpdRequest } from '../mpd-client/requests/AddMpdRequest';
import { AddTagIdMpdRequest } from '../mpd-client/requests/AddTagIdMpdRequest';
import { DeleteIdMpdRequest } from '../mpd-client/requests/DeleteIdMpdRequest';
import { MusicDbService, PopulatedSong } from '../music-db/music-db.service';
import { QobuzService } from '../qobuz/qobuz.service';
import { QobuzTrack } from '../qobuz/qobuz.interfaces';
import { getErrorMessage } from '../../utils/error.utils';
import { lowQualityReason } from './quality.util';

/** How often the upcoming queue is re-read. MPD is the source of truth and any client can change it. */
const SCAN_INTERVAL_MS = 20000;

/** Only a near-certain match may replace what is already queued. */
const MATCH_THRESHOLD = 0.85;

/** Qobuz lookups allowed per pass. The queue barely moves in 20s; there is no need to burn through it. */
const DEFAULT_LOOKUP_BUDGET = 5;

/** One entry of the MPD queue, reduced to the three fields this pass uses. */
interface QueueEntry {
  /** Queue index, from MPD's `Pos`. */
  position: number;
  /** Queue song id, from MPD's `Id`. Stable while the queue shifts around it. */
  id: string;
  /** The uri MPD is holding for this entry. */
  file: string;
}

/** What one pass did, for the logs and for the CLI to print. */
export interface NegentropyPassResult {
  scanned: number;
  candidates: number;
  lookups: number;
  upgraded: number;
  noMatch: number;
  failed: number;
  /** Swaps that needed no lookup because the song already carried a qobuz source. */
  reused: number;
  actions: string[];
}

/**
 * Raises the quality of what is about to play.
 *
 * Looks ahead in the MPD queue, finds entries playing from a low quality local
 * file, and — when Qobuz has the same recording — attaches the qobuz source to
 * the song document and swaps the queue entry over to the stream. Everything
 * happens ahead of the playhead, so nothing interrupts what is playing.
 *
 * The pass is driven by an interval rather than by an event because MPD is the
 * source of truth for what plays next and any other client can reorder the
 * queue at any moment. `negentropy_job` records every song already looked at,
 * which is what keeps a 20s cycle from re-querying Qobuz about a queue that has
 * not changed.
 */
@Injectable()
export class NegentropyService {
  private readonly logger = new Logger(NegentropyService.name);

  /** A pass that outlives its interval must not have a second one start beside it. */
  private running = false;

  constructor(
    @InjectModel(NegentropyJob.name) private negentropyJobModel: Model<NegentropyJobDocument>,
    private readonly mpdClientService: MpdClientService,
    private readonly musicDbService: MusicDbService,
    private readonly qobuzService: QobuzService,
    private readonly configService: ConfigService,
  ) {}

  @Interval(SCAN_INTERVAL_MS)
  async scanQueue(): Promise<void> {
    if (process.env.IS_CLI === 'true') return;
    if (!this.isEnabled()) return;

    if (this.running) {
      this.logger.debug('Previous pass still running, skipping this tick');
      return;
    }

    this.running = true;

    try {
      const result = await this.runOnce();

      if (result.upgraded > 0 || result.reused > 0) {
        this.logger.log(`Upgraded ${result.upgraded + result.reused} queued track(s) to Qobuz`);
      }
    } catch (error: unknown) {
      this.logger.error(`Upgrade pass failed: ${getErrorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** `NEGENTROPY_ENABLED=false` stops the pass without a redeploy. Defaults to on. */
  isEnabled(): boolean {
    const raw = this.configService.get<string>('NEGENTROPY_ENABLED')?.trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'no';
  }

  /**
   * Runs one pass over the upcoming queue.
   *
   * @param options.dryRun - Report what would happen without writing the source,
   *   the job record or the queue. The Qobuz lookups still happen, and with no
   *   job record to stop them they happen again on the next dry run.
   * @param options.limit - Qobuz lookups allowed this pass
   */
  async runOnce(options: { dryRun?: boolean; limit?: number } = {}): Promise<NegentropyPassResult> {
    const dryRun = options.dryRun ?? false;
    let budget = options.limit ?? DEFAULT_LOOKUP_BUDGET;

    const result: NegentropyPassResult = {
      scanned: 0,
      candidates: 0,
      lookups: 0,
      upgraded: 0,
      noMatch: 0,
      failed: 0,
      reused: 0,
      actions: [],
    };

    const upcoming = await this.getUpcomingEntries();
    result.scanned = upcoming.length;

    for (const entry of upcoming) {
      // Already streaming: either an earlier pass put it there, or it was queued
      // from a provider to begin with.
      if (entry.file.includes('/qobuz/track/')) continue;

      const song = await this.musicDbService.findSongBySource('file', entry.file);

      if (!song) {
        this.logger.debug(`Queue entry is not in the library: ${entry.file}`);
        continue;
      }

      const fileSource = (song.source ?? []).find((source) => source.name === 'file');
      const reason = lowQualityReason(fileSource);

      if (!reason) continue;

      result.candidates++;

      // Upgraded on an earlier play, but this queue entry still points at the
      // file. No lookup needed, the id is already on the document.
      const existingQobuzId = (song.source ?? []).find((source) => source.name === 'qobuz')?.sourceId;

      if (existingQobuzId) {
        await this.swapWithExistingSource(entry, song, existingQobuzId, dryRun, result);
        continue;
      }

      if (await this.alreadyProcessed(song._id as Types.ObjectId)) continue;

      if (budget <= 0) {
        this.logger.debug('Lookup budget spent, leaving the rest of the queue for the next pass');
        break;
      }

      budget--;
      result.lookups++;

      await this.upgradeFromQobuz(entry, song, reason, dryRun, result);
    }

    return result;
  }

  /** The queue past the playhead. Everything at or before it is playing or played. */
  private async getUpcomingEntries(): Promise<QueueEntry[]> {
    const status = await this.mpdClientService.send(new StatusMpdRequest());
    const playlist = await this.mpdClientService.send(new PlaylistMpdRequest());

    // Nothing playing: the whole queue is ahead of us.
    const currentPosition = status.song ?? -1;

    return playlist.tracks
      .map((track) => ({
        position: Number(track['Pos']),
        id: track['Id'],
        file: track['file'],
      }))
      .filter((entry) => Number.isFinite(entry.position) && !!entry.id && !!entry.file)
      .filter((entry) => entry.position > currentPosition);
  }

  /** One document per song, so a later pass never re-asks Qobuz about it. */
  private async alreadyProcessed(songId: Types.ObjectId): Promise<boolean> {
    return (await this.negentropyJobModel.exists({ songId })) !== null;
  }

  private async upgradeFromQobuz(
    entry: QueueEntry,
    song: SongDocument,
    reason: string,
    dryRun: boolean,
    result: NegentropyPassResult,
  ): Promise<void> {
    const songId = song._id as Types.ObjectId;
    const [populated] = await this.musicDbService.getPopulatedSongsByIds([songId.toString()]);
    const title = populated?.title ?? song.title;
    const artist = populated?.artist?.artist;
    const album = populated?.album?.title;

    if (!title) {
      this.logger.debug(`Song ${songId} has no title to search Qobuz with`);
      return;
    }

    const label = `"${title}" by ${artist ?? 'unknown'}`;

    try {
      const match = await this.qobuzService.findTrack({ title, artist, album }, MATCH_THRESHOLD);

      if (!match) {
        result.noMatch++;
        result.actions.push(`no match — ${label} (${reason})`);
        await this.recordJob(songId, 'no_match', { title, artist, album, reason }, dryRun);
        return;
      }

      if (!dryRun) {
        const source = this.qobuzService.buildQobuzSource(match.track, match.id);
        await this.musicDbService.addSongSource(songId.toString(), source);
        await this.attachAlbumArtwork(song, match.track);
      }

      const detail = `${reason}, score ${match.score.total.toFixed(2)}`;
      await this.applySwap(entry, match.id, label, detail, dryRun, result, 'upgraded', populated);

      await this.recordJob(
        songId,
        'upgraded',
        { title, artist, album, reason, qobuzTrackId: match.id, score: match.score.total },
        dryRun,
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      result.failed++;
      result.actions.push(`failed — ${label}: ${message}`);
      this.logger.warn(`Could not upgrade ${label}: ${message}`);
      await this.recordJob(songId, 'failed', { title, artist, album, reason, error: message }, dryRun);
    }
  }

  /**
   * Carries the artwork that came back with the Qobuz match over to the album
   * document, when the album has none of its own.
   *
   * This matters more after a swap than before one. The now-playing cover falls
   * back to whatever MPD holds for the queued uri, and MPD can read a picture
   * out of a local file but not out of a proxied stream — so replacing the file
   * with the stream would otherwise leave the track with no artwork at all.
   * Qobuz hands one over in the same response the match came from.
   *
   * Best effort: artwork is never worth failing an upgrade over.
   */
  private async attachAlbumArtwork(song: SongDocument, track: QobuzTrack): Promise<void> {
    const image = track.album?.image;

    if (!image || !song.album) return;

    try {
      const written = await this.musicDbService.setAlbumImageIfMissing(song.album, {
        small: image.small ?? undefined,
        thumbnail: image.thumbnail ?? undefined,
        large: image.large ?? undefined,
        back: image.back ?? undefined,
      });

      if (written) {
        this.logger.log(`Set album artwork on album ${song.album} from Qobuz`);
      }
    } catch (error: unknown) {
      this.logger.warn(`Could not set the album artwork for song ${song._id}: ${getErrorMessage(error)}`);
    }
  }

  /**
   * No Qobuz call and no job record: nothing was looked up, and the swap itself
   * is self-limiting — once the entry points at the stream the next pass skips
   * it on the uri check.
   */
  private async swapWithExistingSource(
    entry: QueueEntry,
    song: SongDocument,
    qobuzTrackId: string,
    dryRun: boolean,
    result: NegentropyPassResult,
  ): Promise<void> {
    const [populated] = await this.musicDbService.getPopulatedSongsByIds([(song._id as Types.ObjectId).toString()]);
    const label = `"${populated?.title ?? song.title}" by ${populated?.artist?.artist ?? 'unknown'}`;

    try {
      await this.applySwap(entry, qobuzTrackId, label, 'already on qobuz', dryRun, result, 'reused', populated);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      result.failed++;
      result.actions.push(`failed — ${label}: ${message}`);
      this.logger.warn(`Could not swap ${label} to its existing qobuz source: ${message}`);
    }
  }

  /**
   * Replaces one queue entry with the Qobuz stream of the same recording.
   *
   * Adds before it deletes: if the delete fails the listener hears the track
   * twice, which is recoverable, whereas deleting first and failing to add
   * would silently drop it from the queue.
   */
  private async applySwap(
    entry: QueueEntry,
    qobuzTrackId: string,
    label: string,
    detail: string,
    dryRun: boolean,
    result: NegentropyPassResult,
    outcome: 'upgraded' | 'reused',
    populated?: PopulatedSong,
  ): Promise<void> {
    if (dryRun) {
      result[outcome]++;
      result.actions.push(`[dry-run] would swap position ${entry.position} — ${label} → qobuz ${qobuzTrackId} (${detail})`);
      return;
    }

    const uri = `${this.getQobuzProxyUrl()}${qobuzTrackId}`;
    const added = await this.mpdClientService.send(new AddMpdRequest(uri, entry.position));
    const newQueueId = added.songId;

    if (!newQueueId) {
      throw new Error(`MPD returned no song id when queueing ${uri}`);
    }

    await this.tagQueueEntry(newQueueId, populated);

    // By id, not position: the insert above shifted this entry down by one.
    await this.mpdClientService.send(new DeleteIdMpdRequest(entry.id));

    result[outcome]++;
    result.actions.push(`swapped position ${entry.position} — ${label} → qobuz ${qobuzTrackId} (${detail})`);
    this.logger.log(`Swapped queue position ${entry.position} to Qobuz ${qobuzTrackId} — ${label}`);
  }

  /**
   * The proxy uri carries no metadata, so the queue entry would show a bare URL
   * in every other MPD client. Best effort: a missing tag is cosmetic.
   */
  private async tagQueueEntry(queueId: string, populated?: PopulatedSong): Promise<void> {
    const tags: [string, string | undefined][] = [
      ['Artist', populated?.artist?.artist],
      ['Title', populated?.title],
      ['Album', populated?.album?.title],
    ];

    for (const [tag, value] of tags) {
      if (!value) continue;

      try {
        await this.mpdClientService.send(new AddTagIdMpdRequest(queueId, tag, value));
      } catch (error: unknown) {
        this.logger.debug(`Could not set ${tag} on queue entry ${queueId}: ${getErrorMessage(error)}`);
      }
    }
  }

  /**
   * Upserted rather than inserted: two passes can reach the same song if one
   * overruns its interval, and the unique index would otherwise throw.
   */
  private async recordJob(
    songId: Types.ObjectId,
    status: NegentropyJobStatus,
    fields: {
      title?: string;
      artist?: string;
      album?: string;
      reason?: string;
      qobuzTrackId?: string;
      score?: number;
      error?: string;
    },
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) return;

    try {
      await this.negentropyJobModel
        .findOneAndUpdate({ songId }, { $set: { songId, status, processedAt: new Date(), ...fields } }, { upsert: true })
        .exec();
    } catch (error: unknown) {
      this.logger.warn(`Could not record the negentropy job for ${songId}: ${getErrorMessage(error)}`);
    }
  }

  private getQobuzProxyUrl(): string {
    const proxy = this.configService.get<string>('QOBUZ_STREAM_PROXY_SERVER');

    if (!proxy) {
      throw new Error('QOBUZ_STREAM_PROXY_SERVER is not defined, cannot queue a Qobuz stream');
    }

    return `${proxy}/qobuz/track/version/1/trackId/`;
  }
}
