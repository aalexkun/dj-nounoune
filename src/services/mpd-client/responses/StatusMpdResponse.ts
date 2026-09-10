import { MpdResponse } from './MpdResponse';

/** MPD reports exactly these three; anything else means the status could not be read. */
export type MpdPlaybackState = 'play' | 'pause' | 'stop';

/**
 * `status` returns the player state alongside the queue position. The transport controls on the
 * /vibing page need it to decide whether the middle button starts or stops playback.
 */
export class StatusMpdResponse extends MpdResponse {
  state: MpdPlaybackState | null = null;
  songId: string | null = null;
  song: number | null = null;
  playlistLength: number | null = null;
  elapsed: number | null = null;
  duration: number | null = null;

  /**
   * MPD's queue version, bumped on **every** change to the queue by any client.
   *
   * The whole reason the queue watcher can poll once a second cheaply: compare this, and only pay
   * for a full `playlistinfo` when it actually moved. Note that it resets when the daemon restarts,
   * which is what `stats`' uptime is there to catch.
   */
  playlistVersion: number | null = null;

  /** 0–100, or null when MPD reports `-1` for a mixer it cannot control. */
  volume: number | null = null;

  repeat = false;
  random = false;
  single = false;
  consume = false;

  constructor(rawResponse: string) {
    super(rawResponse);
    this.parseStatus();
  }

  private parseStatus() {
    const status: Record<string, string> = {};

    for (const line of this.rawResponse.split('\n')) {
      if (line === 'OK' || line.startsWith('ACK')) continue;

      const separatorIndex = line.indexOf(': ');
      if (separatorIndex === -1) continue;

      status[line.substring(0, separatorIndex)] = line.substring(separatorIndex + 2);
    }

    const state = status['state'];
    if (state === 'play' || state === 'pause' || state === 'stop') {
      this.state = state;
    }

    this.songId = status['songid'] ?? null;
    this.song = this.asNumber(status['song']);
    this.playlistLength = this.asNumber(status['playlistlength']);
    this.elapsed = this.asNumber(status['elapsed']);
    this.duration = this.asNumber(status['duration']);
    this.playlistVersion = this.asNumber(status['playlist']);

    // MPD reports -1 when there is no mixer to read, which is not the same as silence.
    const volume = this.asNumber(status['volume']);
    this.volume = volume === null || volume < 0 ? null : volume;

    this.repeat = status['repeat'] === '1';
    this.random = status['random'] === '1';
    this.single = status['single'] === '1';
    this.consume = status['consume'] === '1';
  }

  private asNumber(value: string | undefined): number | null {
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
