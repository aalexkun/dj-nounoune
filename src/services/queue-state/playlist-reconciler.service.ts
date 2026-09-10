import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription, concatMap, from } from 'rxjs';

import { QueueStateService } from './queue-state.service';
import { PlaylistBinding, PlaylistBindingSchema, PLAYLIST_BINDING_TTL_SECONDS, QueueSnapshot, playlistBindingKey } from './queue-state.schema';
import { ChatStreamService } from '../chat/chat-stream.service';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { copyTextFor, PlaylistItem } from '../chat/protocol';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * Keeps the newest `playlist` message in each chat in step with what MPD is actually holding.
 *
 * A playlist envelope published when the disc jockey finished is stale within seconds: negentropy
 * swaps a local file for a stream every twenty seconds, another client can reorder or clear the
 * queue, and playback moves. Because the protocol upserts on `id` and applies on a higher `rev`,
 * fixing that needs no new message type — the same envelope is republished with its rows updated,
 * and the app redraws one message rather than appending another.
 *
 * Only the **newest** playlist per chat is bound, so older ones freeze exactly as they were. Without
 * that, every playlist ever sent would re-broadcast on every queue change.
 */
@Injectable()
export class PlaylistReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaylistReconcilerService.name);
  private readonly subscriptions = new Subscription();

  /** Chats with a live binding. Loaded lazily from Redis, which is the durable copy. */
  private readonly liveChats = new Set<string>();

  constructor(
    private readonly queueState: QueueStateService,
    private readonly chatStream: ChatStreamService,
    private readonly redis: RedisCacheService,
  ) {}

  onModuleInit(): void {
    this.subscriptions.add(
      this.queueState.snapshot$
        // Serialised: two overlapping reconciles of the same envelope would race on `rev`.
        .pipe(concatMap((snapshot) => from(this.reconcile(snapshot))))
        .subscribe({
          error: (error: unknown) => this.logger.error(`Playlist reconciler stopped: ${getErrorMessage(error)}`),
        }),
    );
  }

  onModuleDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /**
   * Binds a chat's newest playlist message to what was just queued.
   *
   * Called by `play_music`, which is the point at which the songs the disc jockey chose actually
   * became MPD queue entries.
   */
  async bind(binding: Omit<PlaylistBinding, 'createdAt'>): Promise<void> {
    const stored: PlaylistBinding = { ...binding, createdAt: Date.now() };

    await this.redis.set(playlistBindingKey(binding.chatId), stored, PLAYLIST_BINDING_TTL_SECONDS);
    this.liveChats.add(binding.chatId);

    // Flip it live now that there is something to keep it in step with.
    await this.chatStream.update(binding.messageId, (envelope) => {
      if (envelope.payload.type !== 'playlist') return envelope;
      return { ...envelope, payload: { ...envelope.payload, live: true } };
    });
  }

  private async reconcile(snapshot: QueueSnapshot): Promise<void> {
    for (const chatId of [...this.liveChats]) {
      try {
        await this.reconcileChat(chatId, snapshot);
      } catch (error: unknown) {
        this.logger.warn(`Could not reconcile the playlist for chat ${chatId}: ${getErrorMessage(error)}`);
      }
    }
  }

  private async reconcileChat(chatId: string, snapshot: QueueSnapshot): Promise<void> {
    const binding = await this.redis.get(playlistBindingKey(chatId), PlaylistBindingSchema);

    if (!binding) {
      this.liveChats.delete(chatId);
      return;
    }

    const updated = await this.chatStream.update(binding.messageId, (envelope) => {
      if (envelope.payload.type !== 'playlist') return envelope;

      const items = envelope.payload.items.map((item) => this.reconcileItem(item, snapshot));
      const payload = { ...envelope.payload, items, mpdVersion: snapshot.version, live: true };

      return { ...envelope, payload, copyText: copyTextFor(payload) };
    });

    if (!updated) {
      // The message is gone; stop paying for it on every tick.
      this.liveChats.delete(chatId);
      await this.redis.delete(playlistBindingKey(chatId));
    }
  }

  /**
   * One row against the live queue.
   *
   * Matched on the **library song id** rather than the MPD queue id, which is what survives a
   * negentropy swap for free: the swap deletes the entry and re-adds it under a new MPD id and a
   * new uri, but the recording — and therefore the song document — is the same. A row with no song
   * document (a catalog-only stream) falls back to matching its source id in the uri.
   */
  private reconcileItem(item: PlaylistItem, snapshot: QueueSnapshot): PlaylistItem {
    const entry = snapshot.entries.find((candidate) =>
      item.songId ? candidate.songId === item.songId : !!item.title && candidate.title === item.title && candidate.artist === item.artist,
    );

    if (!entry) {
      return { ...item, state: 'removed' };
    }

    const playing = entry.mpdSongId === snapshot.currentMpdSongId && snapshot.state !== 'stop';
    const played = snapshot.currentPosition !== null && entry.position < snapshot.currentPosition;

    return {
      ...item,
      // The source MPD is really on, which is the point of reconciling at all: a row that says
      // "file" after negentropy upgraded it to Qobuz is telling the user something untrue.
      source: entry.source,
      position: entry.position,
      state: playing ? 'playing' : played ? 'played' : 'queued',
    };
  }
}
