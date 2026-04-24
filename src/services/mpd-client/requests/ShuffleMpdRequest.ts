import { MpdRequest } from './MpdRequest';
import { ShuffleMpdResponse } from '../responses/ShuffleMpdResponse';

export class ShuffleMpdRequest extends MpdRequest<ShuffleMpdResponse> {
  constructor(private readonly range?: string) {
    super();
  }

  get command(): string {
    return 'shuffle';
  }

  get args(): string[] {
    if (this.range) {
      return [this.range];
    }
    return [];
  }

  createResponse(raw: string): ShuffleMpdResponse {
    return new ShuffleMpdResponse(raw);
  }
}
