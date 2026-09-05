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
 * The streaming providers a queued file can be swapped for, in the order they are asked.
 *
 * The order *is* the quality order: Qobuz streams lossless, Spotify 320 kbps Ogg, YouTube
 * Premium 256 kbps AAC. The pass stops at the first provider that has the recording, so a
 * Qobuz match is never second-guessed by a lossy one.
 */
export const UPGRADE_PROVIDERS = ['qobuz', 'spotify', 'youtube'] as const;

export type UpgradeProvider = (typeof UPGRADE_PROVIDERS)[number];

/**
 * What each provider delivers, on the two axes the comparison needs.
 *
 * These are the same figures the providers' `SongSource` builders write into `technical_info`,
 * so a decision taken here agrees with `PlayMusicHandler.getBestSource` afterwards: if this
 * says the stream beats the file, the play-time scoring picks the stream too.
 */
const PROVIDER_QUALITY: Record<UpgradeProvider, { lossless: boolean; bitrate: number }> = {
  qobuz: { lossless: true, bitrate: 0 },
  spotify: { lossless: false, bitrate: 320000 },
  youtube: { lossless: false, bitrate: 256000 },
};

/**
 * What is known about the audio a `file` source holds, reduced to what the ladder compares.
 *
 * - `lossless` is `true` for a CD-quality or hi-res file, `false` for a known lossy format, and
 *   `undefined` when it cannot be told — no technical info at all, or a format that is not on
 *   the lossy list but is not flagged CD quality either;
 * - `bitrate` is in bits per second, `undefined` when unknown.
 */
export interface FileQuality {
  lossless?: boolean;
  bitrate?: number;
}

/** The format a technical info block names, lower-cased and without a leading dot. */
function formatOf(source: SongSource): string {
  const technical = source.technical_info;

  return (technical?.extension || technical?.encoding || '').toLowerCase().replace(/^\./, '');
}

/** Reads the two axes off a `file` source. */
export function fileQuality(source: SongSource | undefined): FileQuality {
  const technical = source?.technical_info;

  if (!technical) {
    return {};
  }

  const bitrate = technical.bitrate && technical.bitrate > 0 ? technical.bitrate : undefined;

  if (LOSSY_FORMATS.has(formatOf(source))) {
    return { lossless: false, bitrate };
  }

  if (technical.is_cd_quality === true || technical.is_high_res === true) {
    return { lossless: true, bitrate };
  }

  // Not a known lossy format, not flagged as CD quality either: a lossless container at a low
  // sample rate, or a format nobody probed. Below CD quality, but nothing lossy is known to beat
  // it — so `lossless` stays unknown rather than false, which is what keeps Spotify and YouTube
  // off it.
  return { lossless: undefined, bitrate };
}

/**
 * Decides whether a `file` source is worth trying to replace with a stream at all.
 *
 * Three ways in, in order of confidence:
 *  - the format is lossy;
 *  - the source carries technical info and it says the audio is below CD quality;
 *  - the source carries no technical info at all. Those are old imports that predate the ffprobe
 *    pass, and "unknown" skews lossy in this library — the match threshold and the job record keep
 *    the cost of guessing wrong to one round of lookups.
 *
 * Only `file` sources qualify. Anything already streaming from a provider is either the upgrade
 * itself or out of scope.
 */
export function lowQualityReason(source: SongSource | undefined): LowQualityReason {
  if (!source || source.name !== 'file') {
    return null;
  }

  const technical = source.technical_info;

  if (!technical) {
    return 'no technical info';
  }

  const format = formatOf(source);

  if (LOSSY_FORMATS.has(format)) {
    const bitrate = technical.bitrate ? ` @ ${Math.round(technical.bitrate / 1000)}kbps` : '';
    return `lossy ${format}${bitrate}`;
  }

  if (technical.is_cd_quality === false && technical.is_high_res !== true) {
    return `below cd quality${format ? ` (${format})` : ''}`;
  }

  return null;
}

/**
 * Whether a provider's stream would genuinely be better than the file, so that asking it is
 * worth a lookup and swapping to it is not a downgrade.
 *
 * The rules, from the file's point of view:
 *  - **Lossless provider** (Qobuz): always worth it. A lossless stream beats any lossy file and
 *    is at worst equal to a lossless one — and only sub-CD-quality or unknown files get here.
 *  - **Lossy provider** against a **lossy file with a known bitrate**: only when the stream's
 *    bitrate is strictly higher. A 320 kbps mp3 is not worth a Spotify or a YouTube lookup, and a
 *    256 kbps one is worth Spotify but not YouTube.
 *  - **Lossy provider** against a **lossy file with no bitrate**: Spotify yes, YouTube no. An mp3
 *    tops out at 320 kbps, so 320 kbps Ogg is never worse than it; 256 kbps AAC might be.
 *  - **Lossy provider** against a file that is **not known to be lossy** (no technical info, or
 *    a lossless container below CD quality): no. It could be a FLAC, and a lossy stream over a
 *    FLAC is exactly the swap this pass exists to make in the other direction.
 */
export function providerBeatsFile(provider: UpgradeProvider, quality: FileQuality): boolean {
  const stream = PROVIDER_QUALITY[provider];

  if (stream.lossless) {
    return true;
  }

  if (quality.lossless !== false) {
    return false;
  }

  if (quality.bitrate === undefined) {
    return stream.bitrate >= 320000;
  }

  return stream.bitrate > quality.bitrate;
}

/**
 * Whether a source already on the song document is a genuine upgrade over the file, so that the
 * queue entry can be swapped to it without a lookup. Same rule as {@link providerBeatsFile},
 * read off the source's own technical info when it has any.
 */
export function existingSourceBeatsFile(source: SongSource, quality: FileQuality): boolean {
  if (!isUpgradeProvider(source.name)) {
    return false;
  }

  const technical = source.technical_info;

  if (technical?.is_cd_quality || technical?.is_high_res) {
    return true;
  }

  if (technical?.bitrate && quality.lossless === false) {
    return quality.bitrate === undefined ? technical.bitrate >= 320000 : technical.bitrate > quality.bitrate;
  }

  return providerBeatsFile(source.name, quality);
}

export function isUpgradeProvider(name: string): name is UpgradeProvider {
  return (UPGRADE_PROVIDERS as readonly string[]).includes(name);
}

/** The providers worth asking for this file, in ladder order. */
export function providersWorthAsking(quality: FileQuality): UpgradeProvider[] {
  return UPGRADE_PROVIDERS.filter((provider) => providerBeatsFile(provider, quality));
}
