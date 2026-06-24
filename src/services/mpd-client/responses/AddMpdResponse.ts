import { MpdResponse } from './MpdResponse';

export class AddMpdResponse extends MpdResponse {
  get songId(): string | undefined {
    const lines = this.rawResponse.split('\n');
    for (const line of lines) {
      if (line.startsWith('Id: ')) {
        return line.substring(4).trim();
      }
    }
    return undefined;
  }
}
