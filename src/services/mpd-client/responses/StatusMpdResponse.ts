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
  }

  private asNumber(value: string | undefined): number | null {
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
