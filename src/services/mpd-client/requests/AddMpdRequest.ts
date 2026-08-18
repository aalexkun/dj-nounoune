import { MpdRequest } from './MpdRequest';
import { AddMpdResponse } from '../responses/AddMpdResponse';

export class AddMpdRequest extends MpdRequest<AddMpdResponse> {
  /**
   * @param uri - What to queue
   * @param position - Queue index to insert at. Omitted, `addid` appends to the
   *   end, which is what every caller before the upgrade pass wanted.
   */
  constructor(
    private uri: string,
    private position?: number,
  ) {
    super();
  }

  get command(): string {
    return 'addid';
  }

  get args(): string[] {
    return this.position !== undefined ? [this.uri, this.position.toString()] : [this.uri];
  }

  createResponse(raw: string): AddMpdResponse {
    return new AddMpdResponse(raw);
  }
}
