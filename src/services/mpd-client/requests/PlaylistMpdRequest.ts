import { MpdRequest } from './MpdRequest';
import { PlaylistMpdResponse } from '../responses/PlaylistMpdResponse';

export class PlaylistMpdRequest extends MpdRequest<PlaylistMpdResponse> {
  get command(): string {
    return 'playlistinfo';
  }

  get args(): string[] {
    return [];
  }

  createResponse(raw: string): PlaylistMpdResponse {
    return new PlaylistMpdResponse(raw);
  }
}
