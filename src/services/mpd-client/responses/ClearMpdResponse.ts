import { MpdResponse } from './MpdResponse';

export class ClearMpdResponse extends MpdResponse {
  constructor(rawResponse: string) {
    super(rawResponse);
  }
}
