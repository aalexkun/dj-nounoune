import { z } from 'zod';
import { SpotifyArtistMatch, SpotifyTrackHit, SpotifyTrackMatchScore, SpotifyTrackSearchCriteria } from './spotify.interfaces';
import { identitySimilarity, normalizeForMatch, similarity } from '../../utils/text-match.utils';

/**
 * Ranking Spotify search hits against what the caller asked for.
 *
 * Same shape as the Qobuz matcher, and the same numbers, on purpose: a recording should score the
 * same whichever catalog found it, or the negentropy ladder would prefer one provider over another
 * on a scoring quirk rather than on audio quality. The comparison itself lives in
 * `src/utils/text-match.utils.ts`, shared by all three matchers.
 */

/**
 * One line naming the hit that was dropped and the fields responsible, instead of the multi-line
 * JSON dump `ZodError.message` renders.
 */
export function describeParseFailure(item: unknown, error: z.ZodError): string {
  const record = (item ?? {}) as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : 'unknown id';
  const title = typeof record.name === 'string' ? `"${record.name}"` : '(untitled)';

  const fields = error.issues.map((issue) => `${issue.path.join('.') || 'root'} (${issue.message})`).join(', ');

  return `id ${id} ${title} — ${fields}`;
}

/**
 * Relative importance of each criterion when ranking a candidate. Weights of criteria the caller
 * did not provide are dropped and the remainder is re-normalised, so a title-only search still
 * scores on a 0..1 scale.
 */
const WEIGHTS = {
  title: 0.5,
  artist: 0.3,
  album: 0.2,
} as const;

/**
 * Floors a hit has to clear on each criterion the caller actually supplied, applied *before* the
 * weighted total. A criterion the user named is a constraint, not a hint: fail it and the hit is
 * gone, whatever the total says. See the Qobuz matcher for the false positive that taught this.
 */
export const MATCH_FLOOR = {
  title: 0.4,
  artist: 0.6,
  album: 0.5,
} as const;

/** The lead artist of a track, falling back to the album's. */
export function getTrackArtistName(track: SpotifyTrackHit): string {
  return track.artists[0]?.name ?? track.album.artists[0]?.name ?? '';
}

/** Every name credited on the recording or on its album. Features are credited, so they count. */
export function getTrackArtistCandidates(track: SpotifyTrackHit): string[] {
  return [...track.artists, ...track.album.artists].map((artist) => artist.name).filter((name) => !!name);
}

/**
 * Whether the recording is genuinely this artist's, by Spotify's own ids rather than by spelling.
 *
 * Spotify's search does take an `artist:` filter, but it is a text filter over the credits, so
 * "Spice" still pulls in "Spice Girls". An id comparison cannot be talked into another band.
 */
export function trackBelongsToArtist(track: SpotifyTrackHit, artist: SpotifyArtistMatch): boolean {
  if (track.artists.some((credited) => credited.id === artist.id) || track.album.artists.some((credited) => credited.id === artist.id)) {
    return true;
  }

  const wanted = normalizeForMatch(artist.name);

  return getTrackArtistCandidates(track).some((name) => normalizeForMatch(name) === wanted);
}

/**
 * Scores a candidate track against the search criteria. Criteria left undefined contribute
 * nothing and their weight is redistributed.
 */
export function scoreTrack(track: SpotifyTrackHit, criteria: SpotifyTrackSearchCriteria): SpotifyTrackMatchScore {
  const title = similarity(criteria.title, track.name);
  // Artist and album name an entity, so they use the stricter comparison — and the artist is
  // scored against every credit, not just the lead, so a feature still matches.
  const artist = criteria.artist ? Math.max(0, ...getTrackArtistCandidates(track).map((name) => identitySimilarity(criteria.artist, name))) : 0;
  const album = criteria.album ? identitySimilarity(criteria.album, track.album.name) : 0;

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

/** Quotes a value for a Spotify field filter. The API treats a bare `"` as the end of the term. */
function field(name: string, value: string): string {
  return `${name}:"${value.replace(/"/g, '')}"`;
}

/**
 * Builds the search queries to try, most specific first.
 *
 * Spotify's search does have per-field filters (`track:`, `artist:`, `album:`), which is the
 * one real advantage it has over the Qobuz catalog — but a filter is exact enough that a
 * misspelt album sinks an otherwise findable track, so the chain still widens step by step.
 * The third step is free text on purpose: a title Spotify files with a different punctuation
 * fails the `track:` filter and passes the ranker.
 */
export function buildSearchQueries(criteria: SpotifyTrackSearchCriteria): string[] {
  const title = criteria.title?.trim();
  const artist = criteria.artist?.trim();
  const album = criteria.album?.trim();

  if (!title) {
    return [];
  }

  const queries: string[] = [];

  if (artist && album) queries.push([field('track', title), field('artist', artist), field('album', album)].join(' '));
  if (artist) queries.push([field('track', title), field('artist', artist)].join(' '));
  if (album && !artist) queries.push([field('track', title), field('album', album)].join(' '));
  queries.push([title, artist].filter((part) => !!part).join(' '));
  queries.push(field('track', title));

  return [...new Set(queries)];
}

/**
 * Whether a scored hit is worth returning at all, as opposed to merely ranking below another one.
 * Applied to every criterion the caller supplied — see {@link MATCH_FLOOR}.
 */
export function isPlausibleMatch(score: SpotifyTrackMatchScore, criteria: SpotifyTrackSearchCriteria): boolean {
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
