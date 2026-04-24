import { MpdRequest } from './MpdRequest';
import { ConnectMpdResponse } from '../responses/ConnectMpdResponse';

export class ConnectMpdRequest extends MpdRequest<ConnectMpdResponse> {
  get command(): string {
    return 'ping';
  }

  get args(): string[] {
    return [];
  }

  createResponse(raw: string): ConnectMpdResponse {
    return new ConnectMpdResponse(raw);
  }
}
