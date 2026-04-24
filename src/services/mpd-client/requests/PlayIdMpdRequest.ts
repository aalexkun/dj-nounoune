import { MpdRequest } from './MpdRequest';
import { PlayIdMpdResponse } from '../responses/PlayIdMpdResponse';

export class PlayIdMpdRequest extends MpdRequest<PlayIdMpdResponse> {
  constructor(private songId?: number) {
    super();
  }

  get command(): string {
    return 'playid';
  }

  get args(): string[] {
    return this.songId !== undefined ? [this.songId.toString()] : [];
  }

  createResponse(raw: string): PlayIdMpdResponse {
    return new PlayIdMpdResponse(raw);
  }
}
