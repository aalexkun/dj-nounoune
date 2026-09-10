import { Injectable, Logger } from '@nestjs/common';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { NextMpdRequest } from '../mpd-client/requests/NextMpdRequest';
import { PauseMpdRequest } from '../mpd-client/requests/PauseMpdRequest';
import { PlayMpdRequest } from '../mpd-client/requests/PlayMpdRequest';
import { PreviousMpdRequest } from '../mpd-client/requests/PreviousMpdRequest';
import { SeekCurMpdRequest } from '../mpd-client/requests/SeekCurMpdRequest';
import { StopMpdRequest } from '../mpd-client/requests/StopMpdRequest';
import { MpdPlaybackState } from '../mpd-client/responses/StatusMpdResponse';
import { getErrorMessage } from '../../utils/error.utils';

/** Every transport verb both surfaces can ask for. */
export type PlaybackAction = 'next' | 'previous' | 'play' | 'pause' | 'stop' | 'toggle' | 'seek' | 'status';

/** `unknown` means the player could not be reached, which is what greys a control surface out. */
export type PlaybackState = {
  state: MpdPlaybackState | 'unknown';
  /** MPD's queue-level id, not a `Song._id`. Only useful to tell one playing entry from another. */
  songId?: string;
  queueLength?: number;
  at: number;
};

/**
 * The one place playback is driven from.
 *
 * This logic was `VibingGateway`'s, and the transport bar in the chat needs exactly the same
 * behaviour — including the server-side `toggle`, which reads the player's state rather than
 * trusting whatever the caller last saw. Two copies would drift the moment one of them learned
 * about a verb the other did not, so the television and the phone now call the same code and
 * observe each other's effects through MPD.
 *
 * `pause` is new: `PauseMpdRequest` already existed and the /vibing page simply never wired it,
 * which meant the only way to interrupt a track was to stop it and lose the position.
 */
@Injectable()
export class PlaybackControlService {
  private readonly logger = new Logger(PlaybackControlService.name);

  constructor(private readonly mpdClientService: MpdClientService) {}

  async apply(action: PlaybackAction, options: { positionMs?: number } = {}): Promise<PlaybackState> {
    switch (action) {
      case 'next':
        await this.mpdClientService.send(new NextMpdRequest());
        break;
      case 'previous':
        await this.mpdClientService.send(new PreviousMpdRequest());
        break;
      case 'play':
        await this.mpdClientService.send(new PlayMpdRequest());
        break;
      case 'pause':
        await this.mpdClientService.send(new PauseMpdRequest(1));
        break;
      case 'stop':
        await this.mpdClientService.send(new StopMpdRequest());
        break;
      case 'toggle':
        await this.toggle();
        break;
      case 'seek':
        // MPD takes seconds; the protocol carries milliseconds because that is what a scrubber
        // produces. Fractional seconds are accepted, so no rounding is needed.
        await this.mpdClientService.send(new SeekCurMpdRequest((options.positionMs ?? 0) / 1000));
        break;
      case 'status':
        break;
    }

    return this.read();
  }

  /**
   * Resolved server side, so the decision is made on the player's state rather than a stale copy.
   *
   * Deliberately still play/**stop**, not play/pause: this is what the /vibing page's middle button
   * has always done, and quietly changing it while adding `pause` would be a behaviour change
   * nobody asked for. The chat's transport bar does not use it — the server declares an explicit
   * `mpc_play` or `mpc_pause` for the state the player is actually in.
   */
  private async toggle(): Promise<void> {
    const status = await this.mpdClientService.status();

    if (status.state === 'play') {
      await this.mpdClientService.send(new StopMpdRequest());
      return;
    }

    await this.mpdClientService.send(new PlayMpdRequest());
  }

  async read(): Promise<PlaybackState> {
    try {
      const status = await this.mpdClientService.status();

      return {
        state: status.state ?? 'unknown',
        songId: status.songId ?? undefined,
        queueLength: status.playlistLength ?? undefined,
        at: Date.now(),
      };
    } catch (error: unknown) {
      this.logger.warn(`Could not read the MPD status: ${getErrorMessage(error)}`);
      return { state: 'unknown', at: Date.now() };
    }
  }
}
