import { SourceType } from '../schemas/source.schema';

/** The quality facts every `SongSource` builder writes into `technical_info`. */
export type ScorableTechnicalInfo = {
  bitrate?: number;
  sample_rate?: number;
  is_high_res?: boolean;
  is_cd_quality?: boolean;
  /** Seconds. Carried here because a duration is a fact about the encoding, not about the song. */
  duration?: number;
};

export type ScorableSource = {
  name: SourceType;
  /** Nullable because `SongSource.sourceId` is: a local file is addressed by its path instead. */
  sourceId?: string | null;
  technical_info?: ScorableTechnicalInfo;
};

/**
 * One additive scale over the facts the three `SongSource` builders record.
 *
 * Lossless takes the `is_cd_quality` bonus and wins outright. Among the lossy streams it is the
 * **bitrate term** that separates YouTube's 256 kbps AAC from Spotify's 320 kbps Ogg, not the
 * per-source name bonus — those only settle a tie against a local file of the same nominal
 * bitrate, where the stream is the safer pick. Overstate any of it and a YouTube re-encode
 * outranks a local FLAC.
 *
 * Lifted out of `PlayMusicHandler` because the queue watcher and the playlist payload now need the
 * same answer: the source a playlist row *claims* has to be the one playback would actually pick,
 * or the row is wrong the moment it is drawn.
 */
export function scoreSource(source: ScorableSource): number {
  let score = 0;

  if (source.technical_info) {
    if (source.technical_info.is_high_res) score += 1_000_000;
    if (source.technical_info.is_cd_quality) score += 500_000;
    if (source.technical_info.sample_rate) score += source.technical_info.sample_rate;
    if (source.technical_info.bitrate) score += source.technical_info.bitrate / 1000;
  }

  // The default when there is no technical info at all is qobuz.
  if (source.name === 'qobuz') score += 10;
  if (source.name === 'spotify') score += 3;
  if (source.name === 'youtube') score += 1;

  return score;
}

/** The source playback would choose, or `undefined` when there is nothing playable. */
export function getBestSource<T extends ScorableSource>(sources: readonly T[] | undefined): T | undefined {
  if (!sources || sources.length === 0) return undefined;

  return [...sources].sort((a, b) => scoreSource(b) - scoreSource(a))[0];
}
