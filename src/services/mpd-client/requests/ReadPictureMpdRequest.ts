import { MpdRequest } from './MpdRequest';
import { ReadPictureMpdResponse } from '../responses/ReadPictureMpdResponse';

/**
 * `readpicture <uri> <offset>` — the artwork embedded in the audio file's own tags.
 *
 * The server only sends `binarylimit` bytes at a time (8 KiB by default), so a whole picture takes
 * several requests at rising offsets; `MpdClientService.fetchEmbeddedPicture` does that walk.
 */
export class ReadPictureMpdRequest extends MpdRequest<ReadPictureMpdResponse> {
  constructor(
    private uri: string,
    private offset: number = 0,
  ) {
    super();
  }

  get command(): string {
    return 'readpicture';
  }

  get args(): string[] {
    return [this.uri, String(this.offset)];
  }

  get isBinary(): boolean {
    return true;
  }

  createResponse(raw: string | Buffer): ReadPictureMpdResponse {
    return new ReadPictureMpdResponse(raw);
  }
}
