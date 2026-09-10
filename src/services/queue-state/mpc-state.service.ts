import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription, auditTime, concatMap, distinctUntilChanged, from, map, merge } from 'rxjs';

import { QueueStateService } from './queue-state.service';
import { QueueSnapshot } from './queue-state.schema';
import { ChatStreamService } from '../chat/chat-stream.service';
import { sessionContext } from '../chat/chat-context';
import { SessionId } from '../session/session.service';
import { ChatAction, MpcPayload } from '../chat/protocol';
import { shareTargetFor } from '../chat/share-target.util';
import { PlaylogService } from '../playlog/playlog.service';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * How often the elapsed position is corrected on the wire.
 *
 * The client interpolates from `sampledAt`, so it does not need a tick per second — it needs the
 * occasional nudge before local drift becomes visible. Fifteen seconds is invisible to the eye and
 * nearly free on the wire.
 */
const DRIFT_CORRECTION_MS = 15_000;

/**
 * The transport bar, as a message.
 *
 * The bar's buttons are this envelope's `actions`, which is the whole reason the transport is
 * modelled as a message rather than as its own socket protocol: the server decides which controls
 * exist right now — pause while playing, play otherwise, no `previous` at the head of the queue,
 * no `seek` without a duration — and the client draws what arrives. Extending it later means adding
 * action kinds, not inventing a second channel.
 *
 * One live envelope per session, never persisted, regenerated when a session goes active.
 */
@Injectable()
export class MpcStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MpcStateService.name);
  private readonly subscriptions = new Subscription();

  /** The `mpc` envelope currently live for each session, so updates land on the same id. */
  private readonly barBySession = new Map<SessionId, string>();

  constructor(
    private readonly queueState: QueueStateService,
    private readonly chatStream: ChatStreamService,
    private readonly playlog: PlaylogService,
  ) {}

  onModuleInit(): void {
    const payloads$ = this.queueState.snapshot$.pipe(map((snapshot) => this.toPayload(snapshot)));

    // Two streams over one source, doing different jobs. `changes$` reacts to anything a viewer
    // would notice; `drift$` only exists to keep the scrubber honest. Without the projection below
    // the first would fire on every poll, because `elapsedMs` always moves.
    const changes$ = payloads$.pipe(distinctUntilChanged((a, b) => sameProjection(a, b)));
    const drift$ = payloads$.pipe(auditTime(DRIFT_CORRECTION_MS));

    this.subscriptions.add(
      merge(changes$, drift$)
        // Both write to the same envelope id, so the `rev` bumps must not interleave.
        .pipe(concatMap((payload) => from(this.publish(payload))))
        .subscribe({
          error: (error: unknown) => this.logger.error(`Transport bar stopped: ${getErrorMessage(error)}`),
        }),
    );
  }

  onModuleDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /**
   * Gives a session a bar to draw the moment it connects, rather than at the next queue change.
   *
   * The envelope is ephemeral, so there is nothing to replay — it is simply rebuilt from the last
   * projection, which is also why a reconnect never shows a stale transport state.
   */
  async openFor(sessionId: SessionId): Promise<void> {
    const snapshot = await this.queueState.current();
    if (!snapshot) return;

    await this.emitFor(sessionId, this.toPayload(snapshot));
  }

  forget(sessionId: SessionId): void {
    this.barBySession.delete(sessionId);
  }

  private async publish(payload: MpcPayload): Promise<void> {
    for (const sessionId of [...this.barBySession.keys()]) {
      await this.emitFor(sessionId, payload);
    }
  }

  private async emitFor(sessionId: SessionId, payload: MpcPayload): Promise<void> {
    const existing = this.barBySession.get(sessionId);

    try {
      if (existing) {
        const updated = await this.chatStream.update(existing, (envelope) => ({ ...envelope, payload, actions: actionsFor(payload) }));
        if (updated) return;

        // The session ended and took its ephemeral envelope with it.
        this.barBySession.delete(sessionId);
      }

      const created = await this.chatStream.emit(sessionContext(sessionId), payload, { role: 'system', actions: actionsFor(payload) });
      if (created) this.barBySession.set(sessionId, created.id);
    } catch (error: unknown) {
      this.logger.warn(`Could not publish the transport bar to ${sessionId}: ${getErrorMessage(error)}`);
    }
  }

  private toPayload(snapshot: QueueSnapshot): MpcPayload {
    const current = snapshot.entries.find((entry) => entry.mpdSongId === snapshot.currentMpdSongId);
    const now = this.playlog.getLastSnapshot();

    // Prefer the enriched now-playing snapshot — the same one /vibing-on renders, so the two
    // surfaces cannot disagree — and fall back to MPD's own tags when nothing is cached yet.
    const song =
      now && (!current?.songId || now.songId === current.songId)
        ? {
            songId: now.songId,
            title: now.title,
            artist: now.artist,
            album: now.album,
            year: now.year,
            genre: now.genre,
            durationMs: now.duration ? Math.round(now.duration * 1000) : undefined,
            coverUrl: now.coverUrl,
            source: now.sourceName,
            sourceId: current?.sourceId,
            bitrate: now.bitrate,
            sampleRate: now.sampleRate,
            isHighRes: now.isHighRes,
            isCdQuality: now.isCdQuality,
          }
        : current
          ? {
              songId: current.songId ?? current.sourceId,
              title: current.title ?? 'Unknown',
              artist: current.artist ?? 'Unknown',
              album: current.album,
              source: current.source,
              sourceId: current.sourceId,
            }
          : null;

    return {
      type: 'mpc',
      state: snapshot.state,
      song,
      elapsedMs: snapshot.elapsedMs,
      durationMs: snapshot.durationMs,
      sampledAt: snapshot.at,
      volume: snapshot.volume,
      modes: snapshot.modes,
      queue: { position: snapshot.currentPosition, length: snapshot.entries.length },
    };
  }
}

/**
 * Which buttons the bar shows, for the state the player is actually in.
 *
 * Declaring `mpc_play` or `mpc_pause` rather than a single toggle is deliberate: the client should
 * never have to guess what a press will do from a state it may have watched go stale.
 */
function actionsFor(payload: MpcPayload): ChatAction[] {
  const actions: ChatAction[] = [];

  if (payload.queue.length > 0 && (payload.queue.position ?? 0) > 0) {
    actions.push({ kind: 'mpc_previous' });
  }

  actions.push(payload.state === 'play' ? { kind: 'mpc_pause' } : { kind: 'mpc_play' });

  if (payload.state !== 'stop') {
    actions.push({ kind: 'mpc_stop' });
  }

  if (payload.queue.length > 0) {
    actions.push({ kind: 'mpc_next' });
  }

  // No duration, nothing to scrub against — and nothing to validate a client's position against.
  // Declared even while no client draws a scrubber: seeking a stream is not supported yet, and the
  // day it is, the bar gains it without a server deploy.
  if (payload.durationMs) {
    actions.push({ kind: 'mpc_seek', durationMs: payload.durationMs });
  }

  // Not buttons — these are what a long press on the track name opens, the same sheet a playlist
  // row does. Both are resolved on the device, so declaring them costs a round trip to nobody.
  if (payload.song) {
    actions.push({ kind: 'copy' });
    actions.push({
      kind: 'share',
      target: shareTargetFor({
        title: payload.song.title,
        artist: payload.song.artist,
        album: payload.song.album,
        source: payload.song.source,
        sourceId: payload.song.sourceId,
      }),
    });
  }

  return actions;
}

/**
 * Everything a viewer would notice, which pointedly excludes `elapsedMs` and `sampledAt`.
 *
 * This is what stops the bar republishing twice a second for a track nobody has touched. The
 * elapsed position still reaches the client, through the slow drift stream.
 */
function sameProjection(a: MpcPayload, b: MpcPayload): boolean {
  return (
    a.state === b.state &&
    a.song?.songId === b.song?.songId &&
    a.volume === b.volume &&
    a.durationMs === b.durationMs &&
    a.queue.position === b.queue.position &&
    a.queue.length === b.queue.length &&
    a.modes.repeat === b.modes.repeat &&
    a.modes.random === b.modes.random &&
    a.modes.single === b.modes.single &&
    a.modes.consume === b.modes.consume
  );
}
