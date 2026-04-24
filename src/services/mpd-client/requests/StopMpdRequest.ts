import { MpdRequest } from './MpdRequest';
import { StopMpdResponse } from '../responses/StopMpdResponse';

export class StopMpdRequest extends MpdRequest<StopMpdResponse> {
  get command(): string {
    return 'stop';
  }

  get args(): string[] {
    return [];
  }

  createResponse(raw: string): StopMpdResponse {
    return new StopMpdResponse(raw);
  }
}
