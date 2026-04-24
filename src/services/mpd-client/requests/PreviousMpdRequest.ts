import { MpdRequest } from './MpdRequest';
import { PreviousMpdResponse } from '../responses/PreviousMpdResponse';

export class PreviousMpdRequest extends MpdRequest<PreviousMpdResponse> {
  get command(): string {
    return 'previous';
  }

  get args(): string[] {
    return [];
  }

  createResponse(raw: string): PreviousMpdResponse {
    return new PreviousMpdResponse(raw);
  }
}
