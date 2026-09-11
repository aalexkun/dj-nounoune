import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription, concatMap, distinctUntilChanged, from, map } from 'rxjs';

import { QueueStateService } from './queue-state.service';
import { QueueEntry, QueueSnapshot } from './queue-state.schema';
import { ChatStreamService } from '../chat/chat-stream.service';
import { sessionContext } from '../chat/chat-context';
import { SessionId } from '../session/session.service';
import { ChatEnvelope, PayloadOf, copyTextFor } from '../chat/protocol';
import { PlaylistTrack, playlistItems } from '../chat/playlist-payload.util';
import { MusicDbService, PopulatedSong } from '../music-db/music-db.service';
import { getErrorMessage } from '../../utils/error.utils';

type PlaylistPayload = PayloadOf<'playlist'>;

/**
 * MPD's queue as a message, addressed to the session rather than to a conversation.
 *
 * The sibling of `MpcStateService`, and for the same reason. The queue belongs to the daemon: it is
 * one global list that the negentropy pass, every other client on the LAN and playback itself all
 * reshuffle, and no conversation owns it. Projecting it into a chat message could only ever be
 * right for the one chat that happened to call `play_music` — open any other chat, or a fresh
 * install, and the queue screen went blank while twenty-four songs were playing.
 *
 * So this publishes the same `playlist` payload the chat bubble uses, with a **null `chatId`**: one
 * ephemeral envelope per session, rebuilt from the projection when a session goes active, exactly
 * like the transport bar. A reconnect therefore gets the real queue rather than whatever the last
 * conversation happened to remember, and a restart of either side costs nothing, because there is
 * nothing durable to be wrong.
 *
 * This does **not** replace `PlaylistReconcilerService`. That one keeps the disc jockey's own
 * playlist message honest inside the conversation, which is a record of what was asked for. This is
 * the live window onto what the daemon actually holds. They share `playlistItem`, so a row is built
 * one way whichever surface draws it.
 */
@Injectable()
export class QueueMirrorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMirrorService.name);
  private readonly subscriptions = new Subscription();

  /** The `playlist` envelope currently live for each session, so updates land on the same id. */
  private readonly queueBySession = new Map<SessionId, string>();

  /**
   * Library documents behind the current queue, keyed by song id, memoised on the queue version.
   *
   * Rows carry artwork and a duration, and a `QueueEntry` has neither — MPD reports a uri, a
   * position and whatever tags the file or the proxy supplied. Hydrating is therefore one Mongo
   * read, and it happens only when the queue version actually moves, not on the two-second tick.
   */
  private hydratedVersion: number | null = null;
  private hydrated = new Map<string, PopulatedSong>();

  constructor(
    private readonly queueState: QueueStateService,
    private readonly chatStream: ChatStreamService,
    private readonly musicDb: MusicDbService,
  ) {}

  onModuleInit(): void {
    this.subscriptions.add(
      this.queueState.snapshot$
        .pipe(
          // Keyed before the payload is built, not after. Projecting first would mean a Mongo read
          // every two seconds just to discover that nothing changed.
          map((snapshot) => ({ snapshot, key: queueKey(snapshot) })),
          distinctUntilChanged((a, b) => a.key === b.key),
          // One envelope id per session, so the `rev` bumps must not interleave.
          concatMap(({ snapshot }) => from(this.publish(snapshot))),
        )
        .subscribe({
          error: (error: unknown) => this.logger.error(`Queue mirror stopped: ${getErrorMessage(error)}`),
        }),
    );
  }

  onModuleDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /**
   * Gives a session a queue to draw the moment it connects, rather than at the next queue change.
   *
   * That distinction is the whole point of the method: `distinctUntilChanged` means a quiet queue
   * publishes nothing, and a quiet queue is exactly the situation a reconnecting client is in when
   * it has fallen behind. Waiting for the next change would mean waiting for a track to end.
   */
  async openFor(sessionId: SessionId): Promise<ChatEnvelope | null> {
    const snapshot = await this.queueState.current();
    if (!snapshot) return null;

    return await this.emitFor(sessionId, await this.toPayload(snapshot));
  }

  forget(sessionId: SessionId): void {
    this.queueBySession.delete(sessionId);
  }

  private async publish(snapshot: QueueSnapshot): Promise<void> {
    if (this.queueBySession.size === 0) return;

    const payload = await this.toPayload(snapshot);

    for (const sessionId of [...this.queueBySession.keys()]) {
      await this.emitFor(sessionId, payload);
    }
  }

  private async emitFor(sessionId: SessionId, payload: PlaylistPayload): Promise<ChatEnvelope | null> {
    const existing = this.queueBySession.get(sessionId);

    try {
      if (existing) {
        // `copyText` is derived from the rows, so it has to be rebuilt with them — it is both the
        // clipboard payload and the fallback render for a client that does not know this type.
        const updated = await this.chatStream.update(existing, (envelope) => ({ ...envelope, payload, copyText: copyTextFor(payload) }));
        if (updated) return updated;

        // The session ended and took its ephemeral envelope with it.
        this.queueBySession.delete(sessionId);
      }

      const created = await this.chatStream.emit(sessionContext(sessionId), payload, { role: 'system' });
      if (created) this.queueBySession.set(sessionId, created.id);
      return created;
    } catch (error: unknown) {
      this.logger.warn(`Could not publish the queue to ${sessionId}: ${getErrorMessage(error)}`);
      return null;
    }
  }

  private async toPayload(snapshot: QueueSnapshot): Promise<PlaylistPayload> {
    const songs = await this.hydrate(snapshot);

    return {
      type: 'playlist',
      // No title. The live queue is not a named playlist anybody asked for, and the client's own
      // header already says what it is.
      live: true,
      mpdVersion: snapshot.version,
      items: playlistItems(snapshot.entries.map((entry) => this.toTrack(entry, snapshot, songs))),
    };
  }

  private toTrack(entry: QueueEntry, snapshot: QueueSnapshot, songs: Map<string, PopulatedSong>): PlaylistTrack {
    const song = entry.songId ? songs.get(entry.songId) : undefined;

    // The same reading the reconciler uses, so the two surfaces cannot disagree about which row is
    // lit. There is no `removed` state here: this *is* the queue, so a row it does not contain
    // simply is not drawn.
    const playing = entry.mpdSongId === snapshot.currentMpdSongId && snapshot.state !== 'stop';
    const played = snapshot.currentPosition !== null && entry.position < snapshot.currentPosition;

    return {
      songId: entry.songId,
      // MPD's own tags are the fallback, and for a catalog-only stream they are all there is.
      title: entry.title ?? song?.title ?? 'Unknown',
      artist: entry.artist ?? song?.artist?.artist ?? 'Unknown',
      album: entry.album ?? song?.album?.title,
      artworkUrl: song?.album?.image?.large ?? song?.album?.image?.small,
      sources: song?.source,
      // Overrides whatever `getBestSource` would pick: this is what the daemon is really on, which
      // is the difference between a row that says "qobuz" after a negentropy swap and one that
      // still claims the local file it was queued from.
      source: entry.source,
      sourceId: entry.sourceId,
      state: playing ? 'playing' : played ? 'played' : 'queued',
    };
  }

  private async hydrate(snapshot: QueueSnapshot): Promise<Map<string, PopulatedSong>> {
    if (this.hydratedVersion === snapshot.version) return this.hydrated;

    const ids = [...new Set(snapshot.entries.map((entry) => entry.songId).filter((id): id is string => !!id))];

    try {
      const songs = ids.length > 0 ? await this.musicDb.getPopulatedSongsByIds(ids, true) : [];

      this.hydrated = new Map(songs.map((song) => [song._id.toString(), song]));
      this.hydratedVersion = snapshot.version;
    } catch (error: unknown) {
      // Rows without artwork are worth more than no queue at all, and the next version bump will
      // try again. The stale map is deliberately kept: it is right for every entry that survived.
      this.logger.warn(`Could not hydrate the queue: ${getErrorMessage(error)}`);
    }

    return this.hydrated;
  }
}

/**
 * Everything a viewer would notice about the queue, and nothing else.
 *
 * `version` catches any add, delete, move or negentropy swap; the current id and position catch the
 * play head moving through an unchanged queue, which is what repaints the lit row and dims the ones
 * behind it. `elapsedMs` is pointedly absent — that belongs to the transport bar, and including it
 * here would republish the whole queue twice a second forever.
 */
function queueKey(snapshot: QueueSnapshot): string {
  return [snapshot.version, snapshot.state, snapshot.currentMpdSongId ?? '-', snapshot.currentPosition ?? '-', snapshot.entries.length].join('|');
}
