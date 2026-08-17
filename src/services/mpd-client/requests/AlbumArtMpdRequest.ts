import { MpdRequest } from './MpdRequest';
import { AlbumArtMpdResponse } from '../responses/AlbumArtMpdResponse';

/**
 * `albumart <uri> <offset>` — the cover image found in the file's directory rather than in the file.
 *
 * Same chunked delivery as `readpicture`; `MpdClientService.fetchDirectoryArtwork` walks the offsets.
 */
export class AlbumArtMpdRequest extends MpdRequest<AlbumArtMpdResponse> {
  constructor(
    private uri: string,
    private offset: number = 0,
  ) {
    super();
  }

  get command(): string {
    return 'albumart';
  }

  get args(): string[] {
    return [this.uri, String(this.offset)];
  }

  get isBinary(): boolean {
    return true;
  }

  createResponse(raw: string | Buffer): AlbumArtMpdResponse {
    return new AlbumArtMpdResponse(raw);
  }
}
