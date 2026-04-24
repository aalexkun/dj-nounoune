import { MpdRequest } from './MpdRequest';
import { PlayMpdResponse } from '../responses/PlayMpdResponse';

export class PlayMpdRequest extends MpdRequest<PlayMpdResponse> {
  constructor(private songPos?: number) {
    super();
  }

  get command(): string {
    return 'play';
  }

  get args(): string[] {
    return this.songPos !== undefined ? [this.songPos.toString()] : [];
  }

  createResponse(raw: string): PlayMpdResponse {
    return new PlayMpdResponse(raw);
  }
}
