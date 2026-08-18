import { SongSource } from '../../schemas/source.schema';

/**
 * Container/codec names that mean the audio has been through a lossy encoder.
 * Matched against both `extension` and `encoding`, because the bulk of the
 * library was imported with nothing but the file extension filled in.
 */
const LOSSY_FORMATS = new Set(['mp3', 'mp2', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'ra']);

/** Why a source was judged worth replacing, or `null` when it is good enough. */
export type LowQualityReason = string | null;

/**
 * Decides whether a `file` source is worth trying to replace with a Qobuz
 * stream.
 *
 * Three ways in, in order of confidence:
 *  - the format is lossy;
 *  - the source carries technical info and it says the audio is below CD
 *    quality;
 *  - the source carries no technical info at all. Those are old imports that
 *    predate the ffprobe pass, and "unknown" skews lossy in this library — the
 *    0.85 match threshold and the job record keep the cost of guessing wrong to
 *    one Qobuz call.
 *
 * Only `file` sources qualify. Anything already streaming from a provider is
 * either the upgrade itself or out of scope.
 */
export function lowQualityReason(source: SongSource | undefined): LowQualityReason {
  if (!source || source.name !== 'file') {
    return null;
  }

  const technical = source.technical_info;

  if (!technical) {
    return 'no technical info';
  }

  const format = (technical.extension || technical.encoding || '').toLowerCase().replace(/^\./, '');

  if (LOSSY_FORMATS.has(format)) {
    const bitrate = technical.bitrate ? ` @ ${Math.round(technical.bitrate / 1000)}kbps` : '';
    return `lossy ${format}${bitrate}`;
  }

  if (technical.is_cd_quality === false && technical.is_high_res !== true) {
    return `below cd quality${format ? ` (${format})` : ''}`;
  }

  return null;
}
