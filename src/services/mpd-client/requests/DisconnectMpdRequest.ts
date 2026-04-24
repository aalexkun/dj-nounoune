import { MpdRequest } from './MpdRequest';
import { DisconnectMpdResponse } from '../responses/DisconnectMpdResponse';

export class DisconnectMpdRequest extends MpdRequest<DisconnectMpdResponse> {
  get command(): string {
    return 'close';
  }

  get args(): string[] {
    return [];
  }

  createResponse(raw: string): DisconnectMpdResponse {
    return new DisconnectMpdResponse(raw);
  }
}
