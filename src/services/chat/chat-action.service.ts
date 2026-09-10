import { Injectable, Logger } from '@nestjs/common';
import { ChatStreamService } from './chat-stream.service';
import { PlaybackControlService } from '../playback/playback-control.service';
import { MusicDbService, PopulatedSong } from '../music-db/music-db.service';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { AddMpdRequest } from '../mpd-client/requests/AddMpdRequest';
import { DeleteIdMpdRequest } from '../mpd-client/requests/DeleteIdMpdRequest';
import { PlaylistMpdRequest } from '../mpd-client/requests/PlaylistMpdRequest';
import { PlayIdMpdRequest } from '../mpd-client/requests/PlayIdMpdRequest';
import { StatusMpdRequest } from '../mpd-client/requests/StatusMpdRequest';
import { getBestSource } from '../../config/best-source.util';
import { parseSourceUri, qobuzStreamUri, spotifyStreamUri, youtubeStreamUri } from '../../config/source-uri.util';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage } from '../../utils/error.utils';
import { ChatAction, ChatActionRequest } from './protocol';

export type ActionOutcome = { ok: true } | { ok: false; code: string; message: string; retryable: boolean };

const OK: ActionOutcome = { ok: true };

/**
 * Executes an action the server previously declared on a message.
 *
 * The client's copy of the action is never trusted. Before anything runs, the declared set for the
 * named target is rebuilt — by reading the persisted envelope, or, for an ephemeral target like the
 * transport bar, from whatever the live envelope currently says — and the incoming `kind` has to
 * appear in it. So a forged frame finds nothing to run, and a stale one (a button pressed against a
 * revision that has since changed) is rejected rather than acted on.
 *
 * There is no success ack. The **effect is the acknowledgement**: press play and the `mpc` envelope
 * arrives at a higher `rev`, remove a song and the playlist does. Only failures produce anything
 * extra.
 */
@Injectable()
export class ChatActionService {
  private readonly logger = new Logger(ChatActionService.name);

  constructor(
    private readonly chatStream: ChatStreamService,
    private readonly playbackControl: PlaybackControlService,
    private readonly musicDb: MusicDbService,
    private readonly mpd: MpdClientService,
    private readonly configService: ConfigService,
  ) {}

  async execute(request: ChatActionRequest): Promise<ActionOutcome> {
    const declared = await this.declaredActions(request);

    if (!declared.some((action) => action.kind === request.action.kind)) {
      this.logger.warn(`Rejected "${request.action.kind}" on ${request.messageId}: not declared on that target`);
      return { ok: false, code: 'action_not_available', message: 'That action is no longer available.', retryable: false };
    }

    try {
      return await this.run(request);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error(`Action "${request.action.kind}" failed: ${message}`);
      return { ok: false, code: 'action_failed', message, retryable: true };
    }
  }

  /** The action set the server itself put on this target, read back from the source of truth. */
  private async declaredActions(request: ChatActionRequest): Promise<ChatAction[]> {
    const envelope = await this.chatStream.findById(request.messageId);
    if (!envelope) return [];

    if (!request.elementId) return envelope.actions;

    if (envelope.payload.type !== 'playlist') return [];

    return envelope.payload.items.find((item) => item.elementId === request.elementId)?.actions ?? [];
  }

  private async run(request: ChatActionRequest): Promise<ActionOutcome> {
    const action = request.action;

    switch (action.kind) {
      // Resolved on the device; they should never reach the server, but a client that sends one
      // anyway gets a clean answer rather than a crash.
      case 'copy':
      case 'share':
      case 'open_url':
        return OK;

      case 'mpc_play':
        await this.playbackControl.apply('play');
        return OK;
      case 'mpc_pause':
        await this.playbackControl.apply('pause');
        return OK;
      case 'mpc_stop':
        await this.playbackControl.apply('stop');
        return OK;
      case 'mpc_next':
        await this.playbackControl.apply('next');
        return OK;
      case 'mpc_previous':
        await this.playbackControl.apply('previous');
        return OK;

      case 'mpc_seek': {
        const positionMs = request.params?.positionMs;

        // The one action whose value comes from the client. The declaration carried the range, so
        // this is checked against it rather than passed straight to MPD.
        if (positionMs === undefined || positionMs < 0 || positionMs > action.durationMs) {
          return { ok: false, code: 'invalid_position', message: 'That position is outside the track.', retryable: false };
        }

        await this.playbackControl.apply('seek', { positionMs });
        return OK;
      }

      case 'play_now':
        return await this.queueSong(action.songId, { playNow: true });
      case 'queue_next':
        return await this.queueSong(action.songId, { playNow: false });

      case 'remove_from_playlist':
        return await this.removeFromQueue(action.songId);

      case 'song_info':
        // Nothing to run: the client already holds everything the row displays. A dedicated
        // info payload is the natural next addition here.
        return OK;

      case 'retry':
        // Retry re-sends the user's message from the app, which is a `chat:send`, not an action.
        return OK;
    }
  }

  /**
   * Plays or queues a library song.
   *
   * Two things here are easy to get wrong, and the first version got both:
   *
   * - **`next` is not "play this".** Appending to the end of the queue and then skipping forward
   *   plays whatever happened to follow the current track. The chosen song has to be identified by
   *   the queue id MPD hands back from `addid`, and started with `playid`.
   * - **The song is usually already queued.** These actions hang off a playlist message, and that
   *   playlist is what filled the queue in the first place. Adding it again would leave a duplicate
   *   behind every time somebody replayed a track.
   */
  private async queueSong(songId: string, options: { playNow: boolean }): Promise<ActionOutcome> {
    const found = (await this.musicDb.getPopulatedSongsByIds([songId], true))[0];

    if (!found) {
      return { ok: false, code: 'song_not_found', message: 'That song is no longer in the library.', retryable: false };
    }

    const queued = await this.queueEntriesFor(found);

    if (queued.length > 0) {
      // Already in the queue: jump to it rather than adding a second copy. "Play next" on something
      // already coming up is a no-op, which is the honest answer without a `moveid` verb.
      if (options.playNow) {
        await this.mpd.send(new PlayIdMpdRequest(Number(queued[0].id)));
      }
      return OK;
    }

    const best = getBestSource(found.source);
    if (!best) {
      return { ok: false, code: 'no_playable_source', message: 'No playable source for that song.', retryable: false };
    }

    // Insert directly after whatever is playing. Appending to the end is what made "play next"
    // meaningless; `status.song` is the current queue index, and null when nothing is loaded, in
    // which case appending is right.
    const status = await this.mpd.send(new StatusMpdRequest());
    const insertAt = status.song === null ? undefined : status.song + 1;

    const added = await this.mpd.send(new AddMpdRequest(this.streamUri(best.name, best.sourceId ?? ''), insertAt));

    if (options.playNow) {
      // By the id `addid` returned, never by position: a concurrent change to the queue shifts
      // positions, and this app is not the only client pointed at the daemon.
      if (added.songId) {
        await this.mpd.send(new PlayIdMpdRequest(Number(added.songId)));
      } else {
        await this.playbackControl.apply('play');
      }
    }

    return OK;
  }

  /**
   * Removes every queue entry for a song.
   *
   * By MPD id rather than position: an id survives the reordering that removing an earlier entry
   * causes, which is the same reason the negentropy swap deletes by id.
   */
  private async removeFromQueue(songId: string): Promise<ActionOutcome> {
    const song = (await this.musicDb.getPopulatedSongsByIds([songId], true))[0];
    if (!song) {
      return { ok: false, code: 'song_not_found', message: 'That song is no longer in the library.', retryable: false };
    }

    for (const entry of await this.queueEntriesFor(song)) {
      await this.mpd.send(new DeleteIdMpdRequest(entry.id));
    }

    return OK;
  }

  /**
   * Where a song currently sits in the MPD queue, read fresh.
   *
   * Deliberately **not** `QueueStateService.current()`, which is a projection up to two seconds old.
   * Two seconds is a long time on this daemon: the negentropy pass swaps entries every twenty
   * seconds by deleting and re-adding them — which changes both the position and the id — and any
   * other client on the LAN can reorder the queue at will. A deliberate tap is worth one round trip
   * to be certain.
   *
   * Matched through `parseSourceUri` rather than a substring test, so a uri that merely contains a
   * source id somewhere cannot be mistaken for the track itself.
   */
  private async queueEntriesFor(song: PopulatedSong): Promise<Array<{ id: string; position: number }>> {
    const wanted = new Set(song.source.map((source) => source.sourceId).filter((id): id is string => !!id));
    if (wanted.size === 0) return [];

    const queue = await this.mpd.send(new PlaylistMpdRequest());

    return queue.tracks
      .filter((track) => wanted.has(parseSourceUri(track.file ?? '').sourceId))
      .map((track) => ({ id: track.Id ?? '', position: Number(track.Pos ?? -1) }))
      .filter((entry) => entry.id.length > 0);
  }

  private streamUri(source: string, sourceId: string): string {
    if (source === 'qobuz') return qobuzStreamUri(this.configService, sourceId);
    if (source === 'spotify') return spotifyStreamUri(this.configService, sourceId);
    if (source === 'youtube') return youtubeStreamUri(this.configService, sourceId);
    return sourceId;
  }
}
