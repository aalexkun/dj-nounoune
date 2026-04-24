import { MpdResponse } from './MpdResponse';

export class ShuffleMpdResponse extends MpdResponse {
  constructor(rawResponse: string) {
    super(rawResponse);
  }
}
