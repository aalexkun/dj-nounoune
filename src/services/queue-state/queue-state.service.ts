import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Observable, Subject } from 'rxjs';

import { MpdClientService } from '../mpd-client/mpd-client.service';
import { PlaylistMpdRequest } from '../mpd-client/requests/PlaylistMpdRequest';
import { StatsMpdRequest } from '../mpd-client/requests/StatsMpdRequest';
import { StatusMpdRequest } from '../mpd-client/requests/StatusMpdRequest';
import { MusicDbService } from '../music-db/music-db.service';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { parseSourceUri } from '../../config/source-uri.util';
import { getErrorMessage } from '../../utils/error.utils';
import { QUEUE_STATE_KEY, QueueEntry, QueueSnapshot, QueueSnapshotSchema } from './queue-state.schema';

/** How often `status` is read. Cheap: one command, and nothing else unless the version moved. */
const POLL_MS = 2000;

/**
 * How far a derived boot epoch may drift before it counts as a restart.
 *
 * `uptime` has second resolution and the round trip is not free, so the derived value wobbles by a
 * second or two between polls. Anything past this is the daemon having actually restarted.
 */
const BOOT_JITTER_MS = 5000;

/**
 * MPD's queue, projected into something the rest of the app can reason about.
 *
 * The queue drifts for three reasons and none of them originate here: the negentropy pass swaps a
 * local file for a stream every twenty seconds, any other client on the LAN can reorder or clear
 * it, and playback advances on its own. So this polls MPD rather than hooking our own mutators —
 * hooking `applySwap` would catch one cause out of three.
 */
@Injectable()
export class QueueStateService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueStateService.name);

  private readonly snapshots = new Subject<QueueSnapshot>();

  /** Every consumer of the queue — the transport bar, the playlist reconciler — reads this. */
  readonly snapshot$: Observable<QueueSnapshot> = this.snapshots.asObservable();

  private latest: QueueSnapshot | null = null;

  /** The read currently in flight, so the timer can skip it and a refresh can await it. */
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly mpd: MpdClientService,
    private readonly musicDb: MusicDbService,
    private readonly redis: RedisCacheService,
  ) {}

  onModuleDestroy(): void {
    this.snapshots.complete();
  }

  /** The last projection, for a caller that needs one without waiting for the next tick. */
  async current(): Promise<QueueSnapshot | null> {
    if (this.latest) return this.latest;

    // A session that connects before the first poll still needs a transport bar to draw.
    return await this.redis.get(QUEUE_STATE_KEY, QueueSnapshotSchema);
  }

  @Interval(POLL_MS)
  async poll(): Promise<void> {
    // The interval fires on a timer, not on completion. A slow `playlistinfo` must not stack.
    if (this.inFlight) return;
    await this.run();
  }

  /**
   * Reads MPD **now** rather than at the next tick, and hands back what it found.
   *
   * This is what `chat:refresh` is built on, and why the frame is worth having at all: a client
   * that has just reconnected is asking about a daemon it cannot see, and answering it out of a
   * projection up to two seconds old would reproduce, in miniature, the staleness it is trying to
   * escape. Two seconds is a long time here — negentropy swaps entries every twenty, and any other
   * client on the LAN can reorder the queue at will.
   *
   * A read already in flight is joined rather than duplicated, so a room full of phones refreshing
   * at once still costs one round trip to the daemon.
   */
  async refresh(): Promise<QueueSnapshot | null> {
    await (this.inFlight ?? this.run());
    return this.latest;
  }

  /** One read, owning `inFlight` for its whole life. Never rejects: a failed poll is a warning. */
  private run(): Promise<void> {
    const running = this.tick()
      .catch((error: unknown) => {
        this.logger.warn(`Queue poll failed: ${getErrorMessage(error)}`);
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = running;
    return running;
  }

  private async tick(): Promise<void> {
    const [status, stats] = await Promise.all([this.mpd.send(new StatusMpdRequest()), this.mpd.send(new StatsMpdRequest())]);

    const bootEpoch = stats.bootEpoch ?? this.latest?.bootEpoch ?? Date.now();
    const restarted = this.latest !== null && Math.abs(bootEpoch - this.latest.bootEpoch) > BOOT_JITTER_MS;
    const rescanned = this.latest !== null && stats.dbUpdate !== null && stats.dbUpdate !== this.latest.dbUpdate;
    const version = status.playlistVersion ?? 0;

    if (restarted) {
      this.logger.log(`MPD restarted (boot epoch moved by ${Math.round(Math.abs(bootEpoch - (this.latest?.bootEpoch ?? 0)) / 1000)}s) — rebuilding`);
    }
    if (rescanned) {
      this.logger.log('MPD database was updated — re-resolving the queue against the library');
    }

    // Transport state moves on every tick even when the queue does not, so the snapshot is always
    // rebuilt; what the version guards is the expensive part, reading and resolving the entries.
    const reuseEntries = this.latest !== null && !restarted && !rescanned && version === this.latest.version;
    const entries = reuseEntries ? this.latest!.entries : await this.readEntries();

    const snapshot: QueueSnapshot = {
      version,
      bootEpoch,
      dbUpdate: stats.dbUpdate,
      state: status.state ?? 'unknown',
      currentMpdSongId: status.songId,
      currentPosition: status.song,
      elapsedMs: status.elapsed === null ? null : Math.round(status.elapsed * 1000),
      durationMs: status.duration === null ? null : Math.round(status.duration * 1000),
      volume: status.volume,
      modes: { repeat: status.repeat, random: status.random, single: status.single, consume: status.consume },
      entries,
      at: Date.now(),
    };

    const first = this.latest === null;
    this.latest = snapshot;

    if (!reuseEntries) {
      await this.redis.set(QUEUE_STATE_KEY, snapshot, 0);
    }

    if (first) {
      // Announced once, like every other subsystem here: a watcher that silently never ran is the
      // failure mode worth making visible, since everything it feeds degrades quietly.
      this.logger.log(
        `Queue watcher ready — MPD queue version ${version}, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, state ${snapshot.state}`,
      );
    }

    this.snapshots.next(snapshot);
  }

  /**
   * The queue, with every entry resolved back to a library document where one exists.
   *
   * `parseSourceUri` is what makes this source-agnostic: one Mongo match against `source.sourceId`
   * rather than a branch per provider, which is the mistake that used to make the playlog stop
   * recognising half of what plays.
   */
  private async readEntries(): Promise<QueueEntry[]> {
    const queue = await this.mpd.send(new PlaylistMpdRequest());

    const parsed = queue.tracks.map((track, index) => {
      const uri = track.file ?? '';
      const { name, sourceId } = parseSourceUri(uri);

      return {
        mpdSongId: track.Id ?? '',
        position: Number(track.Pos ?? index),
        uri,
        source: name,
        sourceId,
        title: track.Title,
        artist: track.Artist,
        album: track.Album,
      };
    });

    const sourceIds = parsed.map((entry) => entry.sourceId).filter((id) => id.length > 0);
    const bySourceId = await this.musicDb.findSongIdsBySourceIds(sourceIds);

    return parsed.map((entry) => ({ ...entry, songId: bySourceId.get(entry.sourceId) }));
  }
}
