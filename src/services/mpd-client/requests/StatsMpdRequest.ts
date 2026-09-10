import { MpdRequest } from './MpdRequest';
import { StatsMpdResponse } from '../responses/StatsMpdResponse';

/**
 * `stats` — server counters, and the only reliable way to notice MPD restarted.
 *
 * The queue watcher keys its cheap path on `status`'s `playlist` version, but that counter resets
 * when the daemon does, and a reset is invisible to a comparison against a stored value. `uptime`
 * is what makes the restart detectable.
 */
export class StatsMpdRequest extends MpdRequest<StatsMpdResponse> {
  get command(): string {
    return 'stats';
  }

  get args(): string[] {
    return [];
  }

  createResponse(raw: string): StatsMpdResponse {
    return new StatsMpdResponse(raw);
  }
}
