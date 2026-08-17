import { MpdResponse } from './MpdResponse';
import { parseBinaryHeader } from '../binary-response.util';

/** A whole picture, reassembled from however many chunks MPD needed to hand it over. */
export interface MpdPicture {
  mimeType: string;
  data: Buffer;
}

/**
 * Shared shape of the two picture commands. `rawResponse` keeps the text header only — the payload
 * stays a Buffer, since decoding it would corrupt the image.
 *
 * A file that carries no picture answers with a bare `OK`, which lands here as a zero `size` and an
 * empty `data`; that is the caller's signal to try the next source rather than an error.
 */
export abstract class BinaryMpdResponse extends MpdResponse {
  /** Byte length of the whole picture, of which `data` may be only the chunk that was asked for. */
  readonly size: number;

  readonly mimeType?: string;

  /** The chunk starting at the offset the request carried. */
  readonly data: Buffer;

  constructor(raw: string | Buffer) {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'latin1');
    const header = parseBinaryHeader(bytes);
    const headerEnd = header?.headerEnd ?? bytes.length;

    super(bytes.subarray(0, headerEnd).toString('utf8'));

    this.size = header?.size ?? 0;
    this.mimeType = header?.mimeType;
    this.data = header?.hasPayload ? bytes.subarray(headerEnd, headerEnd + header.chunkLength) : Buffer.alloc(0);
  }
}
