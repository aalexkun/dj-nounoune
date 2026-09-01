import { z } from 'zod';
import { QobuzTrack, QobuzTrackMatchScore, QobuzTrackSearchCriteria } from './qobuz.interfaces';
import { similarity } from '../../utils/text-match.utils';

/**
 * One line naming the hit that was dropped and the fields responsible, instead
 * of the multi-line JSON dump `ZodError.message` renders. The point of the log
 * is to say which track was lost and which field to widen.
 */
export function describeParseFailure(item: unknown, error: z.ZodError): string {
  const record = (item ?? {}) as Record<string, unknown>;
  const id = typeof record.id === 'number' || typeof record.id === 'string' ? record.id : 'unknown id';
  const title = typeof record.title === 'string' ? `"${record.title}"` : '(untitled)';

  const fields = error.issues
    .map((issue) => `${issue.path.join('.') || 'root'} (${issue.message})`)
    .join(', ');

  return `id ${id} ${title} — ${fields}`;
}

/**
 * Relative importance of each criterion when ranking a candidate. Weights of
 * criteria the caller did not provide are dropped and the remainder is
 * re-normalised, so a title-only search still scores on a 0..1 scale.
 */
const WEIGHTS = {
  title: 0.5,
  artist: 0.3,
  album: 0.2,
} as const;

/**
 * The fuzzy comparison used to rank hits lives in `src/utils/text-match.utils.ts`, shared with the
 * YouTube matcher. Re-exported here so the Qobuz-facing call sites and their spec keep one import.
 */
export { normalizeForMatch, similarity } from '../../utils/text-match.utils';

/** The performing artist of a track, falling back to the album artist. */
export function getTrackArtistName(track: QobuzTrack): string {
  return track.performer?.name ?? track.album?.artist?.name ?? '';
}

/** The title as displayed, i.e. with the version suffix Qobuz keeps apart. */
export function getTrackDisplayTitle(track: QobuzTrack): string {
  return track.version ? `${track.title} (${track.version})` : track.title;
}

/**
 * Scores a candidate track against the search criteria. Criteria left
 * undefined contribute nothing and their weight is redistributed.
 */
export function scoreTrack(track: QobuzTrack, criteria: QobuzTrackSearchCriteria): QobuzTrackMatchScore {
  // Compare against both the bare title and the version-qualified one: the
  // caller may have typed either.
  const title = Math.max(
    similarity(criteria.title, track.title),
    similarity(criteria.title, getTrackDisplayTitle(track)),
  );
  const artist = criteria.artist ? similarity(criteria.artist, getTrackArtistName(track)) : 0;
  const album = criteria.album ? similarity(criteria.album, track.album?.title) : 0;

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

  return {
    total: weightSum > 0 ? weighted / weightSum : 0,
    title,
    artist,
    album,
  };
}

/**
 * Builds the catalog queries to try, most specific first.
 *
 * Qobuz's catalog search is a single free-text field with no per-field
 * operators, and it returns nothing at all when the combined query is
 * over-specified (a misspelt album title sinks an otherwise findable track).
 * Progressively dropping terms recovers those cases; the caller stops as soon
 * as a query yields a confident match.
 */
export function buildSearchQueries(criteria: QobuzTrackSearchCriteria): string[] {
  const title = criteria.title?.trim();
  const artist = criteria.artist?.trim();
  const album = criteria.album?.trim();

  const combinations = [
    [title, artist, album],
    [title, artist],
    [title, album],
    [title],
  ];

  const queries = combinations
    .map((parts) => parts.filter((part) => !!part).join(' ').trim())
    .filter((query) => query.length > 0);

  return [...new Set(queries)];
}
