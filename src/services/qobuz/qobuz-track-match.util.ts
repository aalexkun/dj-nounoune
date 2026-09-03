import { z } from 'zod';
import { QobuzArtistMatch, QobuzTrack, QobuzTrackMatchScore, QobuzTrackSearchCriteria } from './qobuz.interfaces';
import { identitySimilarity, normalizeForMatch, similarity } from '../../utils/text-match.utils';

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
export { identitySimilarity, normalizeForMatch, similarity } from '../../utils/text-match.utils';

/**
 * Floors a hit has to clear on each criterion the caller actually supplied, applied *before* the
 * weighted total.
 *
 * The weighted total alone cannot express "this is not the record I asked for". With weights of
 * 0.5/0.3, an exact title against a completely wrong artist renormalises to 0.625 — above the 0.6
 * `MINIMUM_MATCH_SCORE` — so "Bad Behaviour" by The Beaches qualified as a Spice track. A criterion
 * the user named is a constraint, not a hint: fail it and the hit is gone, whatever the total says.
 */
export const MATCH_FLOOR = {
  title: 0.4,
  artist: 0.6,
  album: 0.5,
} as const;

/** Credit roles that make someone a performer of the recording rather than a contributor to it. */
const PERFORMING_ROLES = ['mainartist', 'featuredartist', 'artist', 'performer', 'associatedperformer', 'vocals'];

/** The performing artist of a track, falling back to the album artist. */
export function getTrackArtistName(track: QobuzTrack): string {
  return track.performer?.name ?? track.album?.artist?.name ?? '';
}

/**
 * Every name that can fairly be called a performer of this recording.
 *
 * `performer` holds the lead only, so scoring against it alone means a search for a featured
 * artist — "Go Down Deh" by Sean Paul, credited to Spice — finds nothing. Qobuz also ships a
 * `performers` credit string, `"Name, Role - Name, Role - …"`, which carries the features; the
 * roles are filtered so that a producer or a composer does not make the record theirs.
 */
export function getTrackArtistCandidates(track: QobuzTrack): string[] {
  const names = [track.performer?.name, track.album?.artist?.name];

  for (const credit of track.performers?.split(' - ') ?? []) {
    const [name, ...roles] = credit.split(',').map((part) => part.trim());

    if (name && roles.some((role) => PERFORMING_ROLES.includes(normalizeForMatch(role).replace(/ /g, '')))) {
      names.push(name);
    }
  }

  for (const credited of track.album?.artists ?? []) {
    if (credited.roles?.some((role) => PERFORMING_ROLES.includes(normalizeForMatch(role).replace(/ /g, '')))) {
      names.push(credited.name);
    }
  }

  return names.filter((name): name is string => !!name);
}

/**
 * Whether the recording is genuinely this artist's, by Qobuz's own ids rather than by spelling.
 *
 * This is the hard lock the free-text catalog search cannot give: `/catalog/search` takes one
 * undifferentiated query, so "title artist" is a *hint* it may ignore entirely. An id comparison
 * cannot be talked into another band.
 */
export function trackBelongsToArtist(track: QobuzTrack, artist: QobuzArtistMatch): boolean {
  if (track.performer?.id?.toString() === artist.id || track.album?.artist?.id?.toString() === artist.id) {
    return true;
  }

  if (track.album?.artists?.some((credited) => credited.id.toString() === artist.id)) {
    return true;
  }

  const wanted = normalizeForMatch(artist.name);

  return getTrackArtistCandidates(track).some((name) => normalizeForMatch(name) === wanted);
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
  // Artist and album name an entity, so they use the stricter comparison — and the artist is
  // scored against every performing credit, not just the lead, so a feature still matches.
  const artist = criteria.artist
    ? Math.max(0, ...getTrackArtistCandidates(track).map((name) => identitySimilarity(criteria.artist, name)))
    : 0;
  const album = criteria.album ? identitySimilarity(criteria.album, track.album?.title) : 0;

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

/**
 * Whether a scored hit is worth returning at all, as opposed to merely ranking below another one.
 *
 * Applied to every criterion the caller supplied — see {@link MATCH_FLOOR} for why the weighted
 * total cannot do this job on its own.
 */
export function isPlausibleMatch(score: QobuzTrackMatchScore, criteria: QobuzTrackSearchCriteria): boolean {
  if (score.title < MATCH_FLOOR.title) {
    return false;
  }

  if (criteria.artist && score.artist < MATCH_FLOOR.artist) {
    return false;
  }

  if (criteria.album && score.album < MATCH_FLOOR.album) {
    return false;
  }

  return true;
}
