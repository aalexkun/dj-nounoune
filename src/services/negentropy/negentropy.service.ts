import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { NegentropyJob, NegentropyJobDocument, NegentropyJobStatus } from '../../schemas/negentropy-job.schema';
import { SongDocument } from '../../schemas/song.schema';
import { SongSource } from '../../schemas/source.schema';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { PlaylistMpdRequest } from '../mpd-client/requests/PlaylistMpdRequest';
import { StatusMpdRequest } from '../mpd-client/requests/StatusMpdRequest';
import { AddMpdRequest } from '../mpd-client/requests/AddMpdRequest';
import { AddTagIdMpdRequest } from '../mpd-client/requests/AddTagIdMpdRequest';
import { DeleteIdMpdRequest } from '../mpd-client/requests/DeleteIdMpdRequest';
import { AlbumImage, MusicDbService, PopulatedSong } from '../music-db/music-db.service';
import { QobuzService } from '../qobuz/qobuz.service';
import { SpotifyService } from '../spotify/spotify.service';
import { isSpotifyRateLimited } from '../spotify/spotify-error.util';
import { YoutubeService } from '../youtube/youtube.service';
import { bestThumbnailUrl } from '../youtube/youtube-track-match.util';
import { isYoutubeQuotaError } from '../youtube/youtube.interfaces';
import { parseSourceUri, qobuzStreamUri, spotifyStreamUri, youtubeStreamUri } from '../../config/source-uri.util';
import { isSourceActive } from '../../config/active-source.util';
import { getErrorMessage } from '../../utils/error.utils';
import {
  existingSourceBeatsFile,
  FileQuality,
  fileQuality,
  lowQualityReason,
  providersWorthAsking,
  UPGRADE_PROVIDERS,
  UpgradeProvider,
} from './quality.util';

/** How often the upcoming queue is re-read. MPD is the source of truth and any client can change it. */
const SCAN_INTERVAL_MS = 20000;

/** Only a near-certain match may replace what is already queued. */
const MATCH_THRESHOLD = 0.85;

/**
 * YouTube's total score can be carried by the artist alone — a video from the artist's own channel
 * clears it on the artist term — so the title and the artist are floored apart as well. Right
 * artist, wrong song is the one swap worse than no swap.
 */
const YOUTUBE_TITLE_FLOOR = 0.6;
const YOUTUBE_ARTIST_FLOOR = 0.6;

/** Songs looked up per pass. The queue barely moves in 20s; there is no need to burn through it. */
const DEFAULT_LOOKUP_BUDGET = 5;

/** The config key each provider's MPD proxy is read from. Without it the stream cannot be queued. */
const PROVIDER_PROXY_KEY: Record<UpgradeProvider, string> = {
  qobuz: 'QOBUZ_STREAM_PROXY_SERVER',
  spotify: 'SPOTIFY_PROXY_AUDIO',
  youtube: 'YOUTUBE_PROXY_AUDIO',
};

/** One entry of the MPD queue, reduced to the three fields this pass uses. */
interface QueueEntry {
  /** Queue index, from MPD's `Pos`. */
  position: number;
  /** Queue song id, from MPD's `Id`. Stable while the queue shifts around it. */
  id: string;
  /** The uri MPD is holding for this entry. */
  file: string;
}

/** What the song is searched with, the same three fields on every provider. */
interface LookupCriteria {
  title: string;
  artist?: string;
  album?: string;
}

/** A recording one provider has, ready to be attached to the song and queued. */
interface ProviderMatch {
  provider: UpgradeProvider;
  sourceId: string;
  score: number;
  source: SongSource;
  /** The cover the provider handed over with the match, for the album document. */
  albumImage?: AlbumImage;
}

/** What one pass did, for the logs and for the CLI to print. */
export interface NegentropyPassResult {
  scanned: number;
  candidates: number;
  /** Songs looked up, whatever the number of providers each one took. */
  lookups: number;
  /** Provider calls, by provider. */
  providerLookups: Record<UpgradeProvider, number>;
  upgraded: number;
  noMatch: number;
  failed: number;
  /** Swaps that needed no lookup because the song already carried a better source. */
  reused: number;
  /** Candidates left alone because no provider that would beat the file is reachable. */
  skipped: number;
  /** Lookups cut short by a provider's rate limit, left unrecorded so the next pass retries them. */
  deferred: number;
  actions: string[];
}

/**
 * Raises the quality of what is about to play.
 *
 * Looks ahead in the MPD queue, finds entries playing from a low quality local file, and — when
 * a streaming provider has the same recording — attaches that provider's source to the song
 * document and swaps the queue entry over to the stream. Everything happens ahead of the
 * playhead, so nothing interrupts what is playing.
 *
 * The providers are asked in quality order, Qobuz then Spotify then YouTube, and the ladder stops
 * at the first match. It also starts no lower than the file deserves: `quality.util.ts` decides
 * from the file's format and bitrate which providers would genuinely beat it, so a 320 kbps mp3
 * only ever costs a Qobuz lookup — Spotify's 320 kbps Ogg and YouTube's 256 kbps AAC would not
 * be an upgrade, and are not asked.
 *
 * The pass is driven by an interval rather than by an event because MPD is the source of truth
 * for what plays next and any other client can reorder the queue at any moment. `negentropy_job`
 * records every song already looked at, which is what keeps a 20s cycle from re-querying the
 * providers about a queue that has not changed.
 */
@Injectable()
export class NegentropyService {
  private readonly logger = new Logger(NegentropyService.name);

  /** A pass that outlives its interval must not have a second one start beside it. */
  private running = false;

  /** Providers already reported as unreachable, so the reason is logged once and not every 20s. */
  private readonly reportedUnavailable = new Set<UpgradeProvider>();

  constructor(
    @InjectModel(NegentropyJob.name) private negentropyJobModel: Model<NegentropyJobDocument>,
    private readonly mpdClientService: MpdClientService,
    private readonly musicDbService: MusicDbService,
    private readonly qobuzService: QobuzService,
    private readonly spotifyService: SpotifyService,
    private readonly youtubeService: YoutubeService,
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
        this.logger.log(`Upgraded ${result.upgraded + result.reused} queued track(s) to a streaming source`);
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
   * @param options.dryRun - Report what would happen without writing the source, the job record
   *   or the queue. The provider lookups still happen, and with no job record to stop them they
   *   happen again on the next dry run.
   * @param options.limit - Songs looked up this pass. One song may take up to three provider calls.
   */
  async runOnce(options: { dryRun?: boolean; limit?: number } = {}): Promise<NegentropyPassResult> {
    const dryRun = options.dryRun ?? false;
    let budget = options.limit ?? DEFAULT_LOOKUP_BUDGET;

    const result: NegentropyPassResult = {
      scanned: 0,
      candidates: 0,
      lookups: 0,
      providerLookups: { qobuz: 0, spotify: 0, youtube: 0 },
      upgraded: 0,
      noMatch: 0,
      failed: 0,
      reused: 0,
      skipped: 0,
      deferred: 0,
      actions: [],
    };

    const upcoming = await this.getUpcomingEntries();
    result.scanned = upcoming.length;

    for (const entry of upcoming) {
      // Only a local file can be upgraded. Everything else in this mixed queue is already streaming
      // — an entry an earlier pass swapped in, a stream another client queued — and none of them is
      // what this pass is looking for.
      const { name, sourceId } = parseSourceUri(entry.file);

      if (name !== 'file') continue;

      const song = await this.musicDbService.findSongBySource('file', sourceId);

      if (!song) {
        this.logger.debug(`Queue entry is not in the library: ${entry.file}`);
        continue;
      }

      const fileSource = (song.source ?? []).find((source) => source.name === 'file');
      const reason = lowQualityReason(fileSource);

      if (!reason) continue;

      result.candidates++;

      const quality = fileQuality(fileSource);

      // Upgraded on an earlier play, but this queue entry still points at the file. No lookup
      // needed, the id is already on the document — as long as that source is actually better
      // than the file and its provider can still be played.
      const existing = this.bestExistingSource(song, quality);

      if (existing) {
        await this.swapWithExistingSource(entry, song, existing, dryRun, result);
        continue;
      }

      if (await this.alreadyProcessed(song._id)) continue;

      // The rungs of the ladder this file deserves, minus the ones nothing could be queued from.
      const providers = providersWorthAsking(quality).filter((provider) => this.isProviderAvailable(provider));

      if (providers.length === 0) {
        // Not recorded as a job: the providers that would help are not reachable right now, and a
        // permanent no_match would hide the song from the pass once they are.
        result.skipped++;
        result.actions.push(`skipped — "${song.title ?? sourceId}" (${reason}): no reachable provider would beat this file`);
        continue;
      }

      if (budget <= 0) {
        this.logger.debug('Lookup budget spent, leaving the rest of the queue for the next pass');
        break;
      }

      budget--;
      result.lookups++;

      await this.upgradeFromProviders(entry, song, reason, providers, dryRun, result);
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

  /** One document per song, so a later pass never re-asks the providers about it. */
  private async alreadyProcessed(songId: Types.ObjectId): Promise<boolean> {
    return (await this.negentropyJobModel.exists({ songId })) !== null;
  }

  /**
   * Whether a provider's stream can be queued at all: its subscription is active and its MPD
   * proxy is configured. A provider that fails this is left out of the ladder rather than
   * looked up and then failed on the swap.
   */
  private isProviderAvailable(provider: UpgradeProvider): boolean {
    const active = isSourceActive(provider);
    const proxy = !!this.configService.get<string>(PROVIDER_PROXY_KEY[provider]);

    if (active && proxy) {
      this.reportedUnavailable.delete(provider);
      return true;
    }

    if (!this.reportedUnavailable.has(provider)) {
      this.reportedUnavailable.add(provider);
      this.logger.warn(
        `Skipping ${provider} as an upgrade target: ${!active ? 'not in ACTIVE_SOURCE_TYPES' : `${PROVIDER_PROXY_KEY[provider]} is not set`}`,
      );
    }

    return false;
  }

  /**
   * The best source already on the document that genuinely beats the file, in ladder order.
   * `undefined` when the document holds nothing better, or nothing better that can be played.
   */
  private bestExistingSource(song: SongDocument, quality: FileQuality): { provider: UpgradeProvider; sourceId: string } | undefined {
    for (const provider of UPGRADE_PROVIDERS) {
      const source = (song.source ?? []).find((candidate) => candidate.name === provider && !!candidate.sourceId);

      if (!source || !source.sourceId) continue;
      if (!existingSourceBeatsFile(source, quality)) continue;
      if (!this.isProviderAvailable(provider)) continue;

      return { provider, sourceId: source.sourceId };
    }

    return undefined;
  }

  /**
   * Walks the ladder for one song: asks each provider in turn, stops at the first match, attaches
   * its source to the song and swaps the queue entry. A provider that errors is noted and the
   * next one is asked; the song is recorded `failed` only when nothing matched and something
   * broke on the way, `no_match` when every rung came back empty.
   */
  private async upgradeFromProviders(
    entry: QueueEntry,
    song: SongDocument,
    reason: string,
    providers: UpgradeProvider[],
    dryRun: boolean,
    result: NegentropyPassResult,
  ): Promise<void> {
    const songId = song._id;
    const [populated] = await this.musicDbService.getPopulatedSongsByIds([songId.toString()]);
    const title = populated?.title ?? song.title;
    const artist = populated?.artist?.artist;
    const album = populated?.album?.title;

    if (!title) {
      this.logger.debug(`Song ${songId.toString()} has no title to search with`);
      return;
    }

    const criteria: LookupCriteria = { title, artist, album };
    const label = `"${title}" by ${artist ?? 'unknown'}`;
    const tried: UpgradeProvider[] = [];
    const errors: string[] = [];
    let rateLimited = false;

    for (const provider of providers) {
      tried.push(provider);
      result.providerLookups[provider]++;

      let match: ProviderMatch | null;

      try {
        match = await this.lookup(provider, criteria);
      } catch (error: unknown) {
        const message = getErrorMessage(error);

        // "Not now" is not "no": a rate limit says nothing about the recording, and recording it
        // as a failure would hide the song from the pass for good.
        if (this.isRateLimit(provider, error)) {
          rateLimited = true;
          this.logger.warn(`${provider} rate limited the lookup for ${label}, deferring it: ${message}`);
          continue;
        }

        errors.push(`${provider}: ${message}`);
        this.logger.warn(`${provider} lookup failed for ${label}: ${message}`);
        continue;
      }

      if (!match) {
        this.logger.debug(`${provider} has no confident match for ${label}`);
        continue;
      }

      try {
        if (!dryRun) {
          await this.musicDbService.addSongSource(songId.toString(), match.source);
          await this.attachAlbumArtwork(song, match);
        }

        const detail = `${reason}, score ${match.score.toFixed(2)}`;
        await this.applySwap(entry, match.provider, match.sourceId, label, detail, dryRun, result, 'upgraded', populated);

        await this.recordJob(
          songId,
          'upgraded',
          { title, artist, album, reason, provider: match.provider, sourceId: match.sourceId, score: match.score, providersTried: tried },
          dryRun,
        );
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        result.failed++;
        result.actions.push(`failed — ${label}: ${message}`);
        this.logger.warn(`Could not upgrade ${label} to ${match.provider}: ${message}`);
        await this.recordJob(
          songId,
          'failed',
          { title, artist, album, reason, provider: match.provider, error: message, providersTried: tried },
          dryRun,
        );
      }

      return;
    }

    // A rung that was rate limited has not answered, so the ladder is incomplete: leave the song
    // unrecorded and let the next pass climb it again once the limit lifts.
    if (rateLimited) {
      result.deferred++;
      result.actions.push(`deferred — ${label}: a provider rate limited the lookup, retried on the next pass`);
      return;
    }

    if (errors.length > 0) {
      const message = errors.join('; ');
      result.failed++;
      result.actions.push(`failed — ${label}: ${message}`);
      await this.recordJob(songId, 'failed', { title, artist, album, reason, error: message, providersTried: tried }, dryRun);
      return;
    }

    result.noMatch++;
    result.actions.push(`no match — ${label} (${reason}; asked ${tried.join(', ')})`);
    await this.recordJob(songId, 'no_match', { title, artist, album, reason, providersTried: tried }, dryRun);
  }

  /**
   * Whether a provider failed on its quota rather than on the request. Spotify answers a 429 to a
   * Development Mode app after a dozen calls in quick succession; YouTube refuses for the rest of
   * the day once its units are spent. Qobuz has no such signal this pass knows how to read.
   */
  private isRateLimit(provider: UpgradeProvider, error: unknown): boolean {
    switch (provider) {
      case 'spotify':
        return isSpotifyRateLimited(error);
      case 'youtube':
        return isYoutubeQuotaError(error);
      case 'qobuz':
        return false;
    }
  }

  /** One provider's answer for the recording, reduced to what the swap needs. */
  private async lookup(provider: UpgradeProvider, criteria: LookupCriteria): Promise<ProviderMatch | null> {
    switch (provider) {
      case 'qobuz': {
        const match = await this.qobuzService.findTrack(criteria, MATCH_THRESHOLD);

        if (!match) return null;

        const image = match.track.album?.image;

        return {
          provider,
          sourceId: match.id,
          score: match.score.total,
          source: this.qobuzService.buildQobuzSource(match.track, match.id),
          albumImage: image
            ? {
                small: image.small ?? undefined,
                thumbnail: image.thumbnail ?? undefined,
                large: image.large ?? undefined,
                back: image.back ?? undefined,
              }
            : undefined,
        };
      }

      case 'spotify': {
        const match = await this.spotifyService.findTrack(criteria, MATCH_THRESHOLD);

        if (!match) return null;

        return {
          provider,
          sourceId: match.id,
          score: match.score.total,
          source: this.spotifyService.buildSpotifySource(match.track, match.id),
          albumImage: this.spotifyService.toAlbumImage(match.track.album),
        };
      }

      case 'youtube': {
        const match = await this.youtubeService.findTrack(criteria, MATCH_THRESHOLD);

        if (!match) return null;

        // The total alone is not enough here — see the floors for why.
        if (match.score.title < YOUTUBE_TITLE_FLOOR || (criteria.artist && match.score.artist < YOUTUBE_ARTIST_FLOOR)) {
          return null;
        }

        const thumbnail = bestThumbnailUrl(match.thumbnails);

        return {
          provider,
          sourceId: match.id,
          score: match.score.total,
          source: this.youtubeService.buildYoutubeSource(match.id, match.title, match.duration),
          albumImage: thumbnail ? { large: thumbnail } : undefined,
        };
      }
    }
  }

  /**
   * Carries the artwork that came back with the match over to the album document, when the album
   * has none of its own.
   *
   * This matters more after a swap than before one. The now-playing cover falls back to whatever
   * MPD holds for the queued uri, and MPD can read a picture out of a local file but not out of a
   * proxied stream — so replacing the file with the stream would otherwise leave the track with
   * no artwork at all. Every provider hands one over in the same response the match came from.
   *
   * Best effort: artwork is never worth failing an upgrade over.
   */
  private async attachAlbumArtwork(song: SongDocument, match: ProviderMatch): Promise<void> {
    if (!match.albumImage || !song.album) return;

    try {
      const written = await this.musicDbService.setAlbumImageIfMissing(song.album, match.albumImage);

      if (written) {
        this.logger.log(`Set album artwork on album ${song.album.toString()} from ${match.provider}`);
      }
    } catch (error: unknown) {
      this.logger.warn(`Could not set the album artwork for song ${song._id.toString()}: ${getErrorMessage(error)}`);
    }
  }

  /**
   * No provider call and no job record: nothing was looked up, and the swap itself is
   * self-limiting — once the entry points at the stream the next pass skips it on the uri check.
   */
  private async swapWithExistingSource(
    entry: QueueEntry,
    song: SongDocument,
    existing: { provider: UpgradeProvider; sourceId: string },
    dryRun: boolean,
    result: NegentropyPassResult,
  ): Promise<void> {
    const [populated] = await this.musicDbService.getPopulatedSongsByIds([song._id.toString()]);
    const label = `"${populated?.title ?? song.title}" by ${populated?.artist?.artist ?? 'unknown'}`;

    try {
      await this.applySwap(
        entry,
        existing.provider,
        existing.sourceId,
        label,
        `already on ${existing.provider}`,
        dryRun,
        result,
        'reused',
        populated,
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      result.failed++;
      result.actions.push(`failed — ${label}: ${message}`);
      this.logger.warn(`Could not swap ${label} to its existing ${existing.provider} source: ${message}`);
    }
  }

  /** The MPD uri for a provider's stream. Built and parsed in `source-uri.util.ts`, never here. */
  private streamUri(provider: UpgradeProvider, sourceId: string): string {
    switch (provider) {
      case 'qobuz':
        return qobuzStreamUri(this.configService, sourceId);
      case 'spotify':
        return spotifyStreamUri(this.configService, sourceId);
      case 'youtube':
        return youtubeStreamUri(this.configService, sourceId);
    }
  }

  /**
   * Replaces one queue entry with a provider's stream of the same recording.
   *
   * Adds before it deletes: if the delete fails the listener hears the track twice, which is
   * recoverable, whereas deleting first and failing to add would silently drop it from the queue.
   */
  private async applySwap(
    entry: QueueEntry,
    provider: UpgradeProvider,
    sourceId: string,
    label: string,
    detail: string,
    dryRun: boolean,
    result: NegentropyPassResult,
    outcome: 'upgraded' | 'reused',
    populated?: PopulatedSong,
  ): Promise<void> {
    if (dryRun) {
      result[outcome]++;
      result.actions.push(`[dry-run] would swap position ${entry.position} — ${label} → ${provider} ${sourceId} (${detail})`);
      return;
    }

    const uri = this.streamUri(provider, sourceId);
    const added = await this.mpdClientService.send(new AddMpdRequest(uri, entry.position));
    const newQueueId = added.songId;

    if (!newQueueId) {
      throw new Error(`MPD returned no song id when queueing ${uri}`);
    }

    await this.tagQueueEntry(newQueueId, populated);

    // By id, not position: the insert above shifted this entry down by one.
    await this.mpdClientService.send(new DeleteIdMpdRequest(entry.id));

    result[outcome]++;
    result.actions.push(`swapped position ${entry.position} — ${label} → ${provider} ${sourceId} (${detail})`);
    this.logger.log(`Swapped queue position ${entry.position} to ${provider} ${sourceId} — ${label}`);
  }

  /**
   * The proxy uri carries no metadata, so the queue entry would show a bare URL in every other
   * MPD client. Best effort: a missing tag is cosmetic.
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
   * Upserted rather than inserted: two passes can reach the same song if one overruns its
   * interval, and the unique index would otherwise throw.
   */
  private async recordJob(
    songId: Types.ObjectId,
    status: NegentropyJobStatus,
    fields: {
      title?: string;
      artist?: string;
      album?: string;
      reason?: string;
      provider?: UpgradeProvider;
      sourceId?: string;
      providersTried?: UpgradeProvider[];
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
      this.logger.warn(`Could not record the negentropy job for ${songId.toString()}: ${getErrorMessage(error)}`);
    }
  }
}
