import { z } from 'zod';
import {
  YoutubeThumbnails,
  YoutubeTrackMatchScore,
  YoutubeTrackSearchCriteria,
} from './youtube.interfaces';
import { similarity } from '../../utils/text-match.utils';

/**
 * Turning a YouTube upload into library metadata.
 *
 * This is the whole difficulty of the source. Qobuz hands over a track with `title`, `performer`
 * and `album` as separate fields; YouTube hands over one free-text upload title written by whoever
 * uploaded it, in one of a dozen conventions, with promotional noise glued on the end. Everything
 * downstream — the dedup lookup, the merge, the song document — depends on splitting that string
 * correctly, so the parsing lives here rather than inline in the service.
 */

/* -------------------------------------------------------------------------- */
/* Title parsing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Separators used between artist and title, in the order they are tried.
 *
 * The en/em dashes are listed separately from the ASCII hyphen because they are *not*
 * interchangeable in practice: a hyphen needs surrounding spaces to count as a separator
 * (`Jay-Z - Song` must not split on the first hyphen), while a dash is a separator wherever it
 * appears. `｜` and `|` are the YouTube Music convention for `Title | Artist`, i.e. reversed.
 */
const TITLE_SEPARATORS: ReadonlyArray<RegExp> = [
  / [–—] /,
  / - /,
  /：| : /,
];

/**
 * Promotional bracket groups, matched against the *contents* of a group rather than the whole
 * title.
 *
 * Only bracketed text is ever considered: `(Official Video)` is noise, but `Live` in
 * `Live and Let Die` is the song, and a pattern loose enough to catch the first would eat the
 * second. Anchored whole so `Video` is dropped but `Video Killed the Radio Star` is not.
 */
const NOISE_CONTENT: ReadonlyArray<RegExp> = [
  /^(?:official\s*)?(?:music\s*)?video(?:\s*clip)?$/i,
  /^official\s*(?:audio|lyric(?:s)?\s*video|visuali[sz]er|hd\s*video|mv)$/i,
  /^(?:audio|lyrics?|lyric\s*video|visuali[sz]er|full\s*album\s*stream)$/i,
  /^(?:hd|hq|4k|8k|1080p?|720p?)$/i,
  /^(?:with\s*)?lyrics?(?:\s*on\s*screen)?$/i,
  /^(?:free\s*download|download|out\s*now|explicit)$/i,
];

/** A bracket group sitting at the very end of a title, with its delimiters. */
const TRAILING_GROUP = /\s*[([{]([^([{)\]}]*)[)\]}]\s*$/;

/** The `… - Topic` suffix YouTube Music appends to every auto-generated artist channel. */
const TOPIC_SUFFIX = /\s*-\s*topic\s*$/i;

/**
 * Bracket groups worth keeping, even though they look like noise.
 *
 * A remix or a live version is a *different recording*, and dropping the qualifier would let the
 * matcher hand back a studio cut when the caller asked for the Boiler Room set — the same class of
 * mistake as ignoring a Qobuz `version` field.
 */
const MEANINGFUL_QUALIFIER = /\b(?:remix|edit|mix|live|acoustic|cover|instrumental|version|remaster|demo|session|feat\.?|ft\.?)\b/i;

/** The interpreted split of an upload title. */
export interface ParsedVideoTitle {
  /** Artist, or `''` when the title carried no separator and the channel could not supply one. */
  artist: string;
  /** Title with the artist and the promotional noise removed. Never empty. */
  title: string;
}

/**
 * Strips a channel name down to the artist it represents.
 *
 * YouTube Music auto-channels are named `Radiohead - Topic`; that suffix is a YouTube artefact and
 * never part of the name. `VEVO` channels are named `ArtistVEVO`, which is one token and cannot be
 * split safely, so it is left alone — the title itself carries the artist on those uploads.
 */
export function normalizeChannelTitle(channelTitle: string | null | undefined): string {
  if (!channelTitle) {
    return '';
  }

  return channelTitle.replace(TOPIC_SUFFIX, '').trim();
}

/** Whether a channel is a YouTube Music auto-generated artist channel. */
export function isTopicChannel(channelTitle: string | null | undefined): boolean {
  return !!channelTitle && TOPIC_SUFFIX.test(channelTitle);
}

/**
 * Removes promotional bracket groups from the end of a title.
 *
 * Groups are peeled off one at a time rather than matched against the whole string, because
 * uploads stack them in any order — `Song (Official Video) [4K Remaster]`. Stripping only what sits
 * at the very end would stop at the remaster tag and leave the `(Official Video)` in front of it
 * untouched, so a meaningful group is set aside and the peeling continues behind it.
 *
 * Three outcomes per group:
 *  - it names a real variant (remix, live, acoustic…) — kept, because that is a *different
 *    recording* and dropping it would match a studio cut to a request for the live one;
 *  - it is recognised promotional noise — dropped;
 *  - it is neither — peeling stops, since an unrecognised group is more likely part of the title
 *    than something safe to throw away.
 */
export function stripTitleNoise(title: string): string {
  let current = title.trim();
  const kept: string[] = [];

  for (;;) {
    const match = TRAILING_GROUP.exec(current);

    if (!match) {
      break;
    }

    const content = (match[1] ?? '').trim();
    const withoutGroup = current.slice(0, match.index).trim();

    // Never peel a group that is the entire title — `(Reprise)` alone is all the name there is.
    if (!withoutGroup) {
      break;
    }

    if (MEANINGFUL_QUALIFIER.test(content)) {
      kept.unshift(current.slice(match.index).trim());
      current = withoutGroup;
      continue;
    }

    if (NOISE_CONTENT.some((pattern) => pattern.test(content))) {
      current = withoutGroup;
      continue;
    }

    break;
  }

  const result = [current, ...kept].filter((part) => !!part).join(' ').trim();

  return result || title.trim();
}

/**
 * Splits an upload title into artist and title.
 *
 * @param videoTitle - The raw `snippet.title`
 * @param channelTitle - The uploading channel, used as the artist when the title carries no
 *   separator. On a `- Topic` channel this is authoritative and is preferred over a split, because
 *   YouTube Music generates those titles as the bare track name.
 *
 * A title with no separator and no usable channel yields `artist: ''` — that is an honest miss,
 * and the caller decides whether to keep the hit. Inventing an artist from the first word is the
 * one failure mode that would poison the library, since every downstream dedup match keys on it.
 */
export function parseVideoTitle(videoTitle: string, channelTitle?: string | null): ParsedVideoTitle {
  const raw = (videoTitle ?? '').trim();
  const channelArtist = normalizeChannelTitle(channelTitle);

  if (!raw) {
    return { artist: channelArtist, title: '' };
  }

  // A Topic channel names the artist outright and its titles are the bare track name, so any
  // ` - ` inside one belongs to the title (`Sgt. Pepper's - Reprise`) and must not be split.
  if (isTopicChannel(channelTitle)) {
    return { artist: channelArtist, title: stripTitleNoise(raw) };
  }

  for (const separator of TITLE_SEPARATORS) {
    const match = separator.exec(raw);

    if (!match || match.index === undefined) {
      continue;
    }

    const left = raw.slice(0, match.index).trim();
    const right = raw.slice(match.index + match[0].length).trim();

    if (!left || !right) {
      continue;
    }

    return { artist: left, title: stripTitleNoise(right) };
  }

  return { artist: channelArtist, title: stripTitleNoise(raw) };
}

/* -------------------------------------------------------------------------- */
/* Duration                                                                   */
/* -------------------------------------------------------------------------- */

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * ISO 8601 duration to seconds. YouTube reports `PT4M13S`; a live stream still in progress
 * reports `P0D`, which parses to zero and is exactly how the caller should read it.
 *
 * @returns Whole seconds, or 0 for anything unparseable
 */
export function parseIsoDuration(duration: string | null | undefined): number {
  if (!duration) {
    return 0;
  }

  const match = ISO_DURATION.exec(duration.trim());

  if (!match) {
    return 0;
  }

  const [, days, hours, minutes, seconds] = match;

  return Math.round(
    (days ? parseInt(days, 10) * 86400 : 0) +
      (hours ? parseInt(hours, 10) * 3600 : 0) +
      (minutes ? parseInt(minutes, 10) * 60 : 0) +
      (seconds ? parseFloat(seconds) : 0),
  );
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Relative importance of each criterion, mirroring the Qobuz matcher so a hit scores comparably
 * whichever catalog found it.
 *
 * Album is weighted lower here than it is for Qobuz: a YouTube video has no album field at all,
 * so it is scored against the channel and the raw title, both weak proxies.
 */
const WEIGHTS = {
  title: 0.5,
  artist: 0.3,
  album: 0.1,
} as const;

/**
 * Bonuses that survive normalisation, expressed as a fraction of the final score.
 *
 * A Topic channel upload is the closest YouTube gets to an official release: auto-generated by
 * YouTube Music from the label's delivery, correctly titled, and audio-only. When two hits match
 * the query equally well, that is the one to take, and without a nudge the free-text score cannot
 * tell it from a fan re-upload of the same song.
 */
const TOPIC_CHANNEL_BONUS = 0.06;
const MUSIC_CATEGORY_BONUS = 0.02;

/** What `scoreVideo` needs to know about a candidate. */
export interface ScorableVideo {
  /** Interpreted title, after `parseVideoTitle`. */
  title: string;
  /** Interpreted artist, after `parseVideoTitle`. */
  artist: string;
  /** Raw upload title, scored as a fallback when the split guessed wrong. */
  videoTitle: string;
  channelTitle?: string;
  isTopicChannel: boolean;
  isMusicCategory: boolean;
}

/**
 * Scores a candidate against the search criteria. Criteria left undefined contribute nothing and
 * their weight is redistributed, so a title-only search still scores on a 0..1 scale.
 *
 * The title is compared against both the interpreted and the raw upload title: when the split
 * guessed wrong, the raw string still contains everything the caller typed, and scoring only the
 * interpreted half would throw away a hit that a human would call correct.
 */
export function scoreVideo(video: ScorableVideo, criteria: YoutubeTrackSearchCriteria): YoutubeTrackMatchScore {
  const title = Math.max(
    similarity(criteria.title, video.title),
    similarity(criteria.title, video.videoTitle),
  );

  const artist = criteria.artist
    ? Math.max(
        similarity(criteria.artist, video.artist),
        similarity(criteria.artist, normalizeChannelTitle(video.channelTitle)),
        // The raw title usually still carries the artist even when the split failed.
        similarity(criteria.artist, video.videoTitle),
      )
    : 0;

  // There is no album field on a video. The upload title of an album track often names it, and a
  // Topic channel's videos come from a release, so both are compared — weakly, hence the weight.
  const album = criteria.album ? similarity(criteria.album, video.videoTitle) : 0;

  let weightSum = WEIGHTS.title;
  let weighted = WEIGHTS.title * title;

  if (criteria.artist) {
    weightSum += WEIGHTS.artist;
    weighted += WEIGHTS.artist * artist;
  }

  if (criteria.album) {
    weightSum += WEIGHTS.album;
    weighted += WEIGHTS.album * album;
  }

  const base = weightSum > 0 ? weighted / weightSum : 0;

  let total = base;
  if (video.isTopicChannel) total += TOPIC_CHANNEL_BONUS;
  if (video.isMusicCategory) total += MUSIC_CATEGORY_BONUS;

  return {
    total: Math.min(1, total),
    title,
    artist,
    album,
  };
}

/* -------------------------------------------------------------------------- */
/* Query building                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Builds the search queries to try, most specific first.
 *
 * Unlike Qobuz this is a real relevance engine over the whole of YouTube, so over-specifying
 * rarely returns nothing — it returns the *wrong thing*, usually a reaction video or a mix that
 * mentions every term. Dropping terms therefore matters less for recall than it does for Qobuz,
 * and the list is kept short on purpose: `search.list` costs 100 quota units per call against a
 * 10,000-unit daily default, so a four-query fallback chain is 4% of the day's budget per lookup.
 */
export function buildSearchQueries(criteria: YoutubeTrackSearchCriteria): string[] {
  const title = criteria.title?.trim();
  const artist = criteria.artist?.trim();
  const album = criteria.album?.trim();

  const combinations = [
    [artist, title],
    [artist, album, title],
    [title],
  ];

  const queries = combinations
    .map((parts) => parts.filter((part) => !!part).join(' ').trim())
    .filter((query) => query.length > 0);

  return [...new Set(queries)];
}

/**
 * One line naming the item that was dropped and the fields responsible, instead of the multi-line
 * JSON dump `ZodError.message` renders. Same intent as the Qobuz version: say which track was lost
 * and which field to widen.
 */
export function describeParseFailure(item: unknown, error: z.ZodError): string {
  const record = (item ?? {}) as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : 'unknown id';
  const snippet = record.snippet as Record<string, unknown> | undefined;
  const title = typeof snippet?.title === 'string' ? `"${snippet.title}"` : '(untitled)';

  const fields = error.issues
    .map((issue) => `${issue.path.join('.') || 'root'} (${issue.message})`)
    .join(', ');

  return `id ${id} ${title} — ${fields}`;
}

/**
 * The largest thumbnail YouTube offered, as the album artwork the negentropy pass and the
 * /vibing-on page read. Ordered biggest first because the page renders it full-bleed.
 */
export function bestThumbnailUrl(thumbnails: YoutubeThumbnails | undefined): string | undefined {
  if (!thumbnails) {
    return undefined;
  }

  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url
  );
}
