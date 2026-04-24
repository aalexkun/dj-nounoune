import { MpdResponse } from './MpdResponse';

export class ConnectMpdResponse extends MpdResponse {
  isSuccess(): boolean {
    return this.rawResponse.startsWith('OK');
  }
}
