/**
 * `albumart` and `readpicture` are the only MPD commands that answer with raw bytes, and they need
 * their own framing rules. Their reply is a short text header followed by the picture itself:
 *
 * ```
 * size: 51023        <- byte length of the whole picture
 * type: image/jpeg   <- absent on servers older than 0.22 for `albumart`
 * binary: 8192       <- byte length of this chunk only, capped by the server's binarylimit
 * <8192 raw bytes>
 * OK
 * ```
 *
 * The payload can hold anything, `OK\n` included, so the usual "response ends at the last OK" rule
 * cannot be used on it: the length announced by `binary:` is what says where the picture stops.
 */

const NEWLINE = 0x0a;

export interface MpdBinaryHeader {
  /** Byte length of the whole picture, across every chunk. Zero when the reply carries none. */
  size: number;
  mimeType?: string;
  /** Byte length of the chunk in this reply. */
  chunkLength: number;
  /** Offset where the payload starts, right after the `binary:` line. */
  headerEnd: number;
  /** False when the reply held no `binary:` line — a file without a picture answers a bare `OK`. */
  hasPayload: boolean;
}

/** Reads the header lines. Returns null while they are still arriving. */
export function parseBinaryHeader(raw: Buffer): MpdBinaryHeader | null {
  let size = 0;
  let mimeType: string | undefined;
  let start = 0;

  while (start < raw.length) {
    const lineEnd = raw.indexOf(NEWLINE, start);
    if (lineEnd === -1) return null;

    const line = raw.subarray(start, lineEnd).toString('utf8');
    start = lineEnd + 1;

    if (line.startsWith('binary: ')) {
      return { size, mimeType, chunkLength: toNumber(line.substring(8)), headerEnd: start, hasPayload: true };
    }

    // A bare `OK` ends a reply that carried no picture, an `ACK` one the server refused.
    if (line === 'OK' || line.startsWith('ACK')) {
      return { size, mimeType, chunkLength: 0, headerEnd: start, hasPayload: false };
    }

    if (line.startsWith('size: ')) size = toNumber(line.substring(6));
    else if (line.startsWith('type: ')) mimeType = line.substring(6);
  }

  return null;
}

/** Whether the header, the announced payload and the `OK` closing it have all arrived. */
export function isBinaryResponseComplete(raw: Buffer): boolean {
  const header = parseBinaryHeader(raw);

  if (!header) return false;
  if (!header.hasPayload) return true;

  const payloadEnd = header.headerEnd + header.chunkLength;
  if (raw.length <= payloadEnd) return false;

  // MPD writes a newline after the bytes, then the usual terminator.
  return raw.subarray(payloadEnd).toString('latin1').includes('OK\n');
}

/**
 * Older servers report no `type:` for `albumart`, so the format is read off the first bytes instead.
 * Falls back to jpeg, which is what all but a handful of the covers on disk are.
 */
export function detectMimeType(data: Buffer): string {
  if (data.length >= 8 && data.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (data.length >= 3 && data.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function toNumber(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
