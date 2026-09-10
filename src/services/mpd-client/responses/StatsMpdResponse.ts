import { MpdResponse } from './MpdResponse';

/**
 * What `stats` reports:
 *
 * ```
 * uptime: 84320
 * playtime: 14210
 * artists: 312
 * albums: 154
 * songs: 2405
 * db_playtime: 602319
 * db_update: 1714500120
 * ```
 *
 * Two of these matter to the queue watcher. `uptime` gives a **boot epoch** — `now - uptime` — that
 * is stable across polls and therefore comparable against a stored value, which a raw uptime is not
 * once the watcher itself has missed a tick or restarted. `db_update` changes when the library is
 * rescanned, which invalidates any cached mapping from a queue uri back to a song document.
 */
export class StatsMpdResponse extends MpdResponse {
  /** Seconds the daemon has been running. */
  uptime: number | null = null;
  /** Unix seconds of the last database update. */
  dbUpdate: number | null = null;
  songs: number | null = null;
  albums: number | null = null;
  artists: number | null = null;

  constructor(rawResponse: string) {
    super(rawResponse);
    this.parseStats();
  }

  /**
   * Epoch ms the daemon started, derived from `uptime`.
   *
   * A few seconds of jitter is expected — `uptime` has second resolution and the round trip is not
   * instant — so callers compare with a tolerance rather than for equality.
   */
  get bootEpoch(): number | null {
    return this.uptime === null ? null : Date.now() - this.uptime * 1000;
  }

  private parseStats() {
    const stats: Record<string, string> = {};

    for (const line of this.rawResponse.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === 'OK' || trimmed.startsWith('ACK') || trimmed === '') continue;

      const separatorIndex = trimmed.indexOf(': ');
      if (separatorIndex === -1) continue;

      stats[trimmed.substring(0, separatorIndex)] = trimmed.substring(separatorIndex + 2);
    }

    this.uptime = asNumber(stats['uptime']);
    this.dbUpdate = asNumber(stats['db_update']);
    this.songs = asNumber(stats['songs']);
    this.albums = asNumber(stats['albums']);
    this.artists = asNumber(stats['artists']);
  }
}

function asNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
