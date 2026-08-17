import { MpdRequest } from './MpdRequest';
import { StatusMpdResponse } from '../responses/StatusMpdResponse';

export class StatusMpdRequest extends MpdRequest<StatusMpdResponse> {
  get command(): string {
    return 'status';
  }

  get args(): string[] {
    return [];
  }

  createResponse(raw: string): StatusMpdResponse {
    return new StatusMpdResponse(raw);
  }
}
