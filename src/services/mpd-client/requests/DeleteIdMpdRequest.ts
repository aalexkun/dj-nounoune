import { MpdRequest } from './MpdRequest';
import { DeleteIdMpdResponse } from '../responses/DeleteIdMpdResponse';

/**
 * `deleteid {SONGID}` removes one entry from the queue by its song id rather
 * than its position, so it stays correct if the queue shifts underneath us.
 */
export class DeleteIdMpdRequest extends MpdRequest<DeleteIdMpdResponse> {
  constructor(private songId: string) {
    super();
  }

  get command(): string {
    return 'deleteid';
  }

  get args(): string[] {
    return [this.songId];
  }

  createResponse(raw: string): DeleteIdMpdResponse {
    return new DeleteIdMpdResponse(raw);
  }
}
