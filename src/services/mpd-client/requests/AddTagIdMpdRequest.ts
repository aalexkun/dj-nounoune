import { MpdRequest } from './MpdRequest';
import { AddTagIdMpdResponse } from '../responses/AddTagIdMpdResponse';

export class AddTagIdMpdRequest extends MpdRequest<AddTagIdMpdResponse> {
  constructor(
    private songId: string,
    private tag: string,
    private value: string,
  ) {
    super();
  }

  get command(): string {
    return 'addtagid';
  }

  get args(): string[] {
    return [this.songId, this.tag, this.value];
  }

  createResponse(raw: string): AddTagIdMpdResponse {
    return new AddTagIdMpdResponse(raw);
  }
}
