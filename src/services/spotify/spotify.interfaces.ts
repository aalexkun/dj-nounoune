import { z } from 'zod';

/**
 * The slice of the Spotify Web API this service reads, as Zod schemas.
 *
 * `spotify-web-api-node` ships typings for every response, but a typing is a promise about the
 * wire, not a check of it. Everything that leaves the SDK and enters a matcher goes through one
 * of these first, the same way the Qobuz and YouTube services parse their own raw payloads —
 * so a field Spotify drops or renames shows up as one discarded hit with a warning, not as an
 * `undefined` three calls later.
 *
 * Every schema is lenient about what it does not read: Spotify adds fields freely, and a strict
 * object here would throw away real hits for nothing.
 */

export const SpotifyImageSchema = z.object({
  url: z.string(),
  height: z.number().nullish(),
  width: z.number().nullish(),
});

export type SpotifyImage = z.infer<typeof SpotifyImageSchema>;

/** An artist as it appears embedded in a track or an album: id and name, nothing more. */
export const SpotifyArtistRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type SpotifyArtistRef = z.infer<typeof SpotifyArtistRefSchema>;

/** An album as it appears embedded in a track hit, and as `getArtistAlbums` lists them. */
export const SpotifyAlbumRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  album_type: z.string().optional(),
  release_date: z.string().optional(),
  total_tracks: z.number().optional(),
  images: z.array(SpotifyImageSchema).default([]),
  artists: z.array(SpotifyArtistRefSchema).default([]),
});

export type SpotifyAlbumRef = z.infer<typeof SpotifyAlbumRefSchema>;

/** A track as the search endpoint and `getTrack` return it. */
export const SpotifyTrackHitSchema = z.object({
  id: z.string(),
  name: z.string(),
  duration_ms: z.number().default(0),
  track_number: z.number().optional(),
  disc_number: z.number().optional(),
  explicit: z.boolean().optional(),
  /** Present only when a market was applied to the request. Absent means "not checked". */
  is_playable: z.boolean().optional(),
  /** Deprecated for Development Mode apps since February 2026, so usually absent — kept for when it is not. */
  external_ids: z.object({ isrc: z.string().optional() }).optional(),
  artists: z.array(SpotifyArtistRefSchema).default([]),
  album: SpotifyAlbumRefSchema,
});

export type SpotifyTrackHit = z.infer<typeof SpotifyTrackHitSchema>;

/** A track as `getAlbumTracks` lists them: no album block of its own, it belongs to the one asked for. */
export const SpotifyAlbumTrackSchema = SpotifyTrackHitSchema.omit({ album: true });

export type SpotifyAlbumTrack = z.infer<typeof SpotifyAlbumTrackSchema>;

/** An artist as the search endpoint and `getArtist` return it. */
export const SpotifyArtistHitSchema = z.object({
  id: z.string(),
  name: z.string(),
  genres: z.array(z.string()).default([]),
  images: z.array(SpotifyImageSchema).default([]),
  followers: z.object({ total: z.number().nullish() }).optional(),
  popularity: z.number().optional(),
});

export type SpotifyArtistHit = z.infer<typeof SpotifyArtistHitSchema>;

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export interface SpotifyTrackSearchCriteria {
  /** Track title. The only mandatory criterion. */
  title: string;
  /** Performing artist, used both to narrow the query and to rank results. */
  artist?: string;
  /** Album title, used both to narrow the query and to rank results. */
  album?: string;
  /** Maximum number of items requested per query. Defaults to 25, capped at 50 by Spotify. */
  limit?: number;
  /**
   * Return every hit seen, including the ones that fail a stated criterion. For debugging what the
   * catalog actually answered; never for a caller that will act on the result.
   */
  includeRejected?: boolean;
}

export interface SpotifyTrackMatchScore {
  total: number;
  title: number;
  artist: number;
  album: number;
}

export interface SpotifyTrackMatch {
  /** The Spotify track id — what the search is ultimately after. */
  id: string;
  title: string;
  artist: string;
  /** Every credited artist, lead first. */
  artists: SpotifyArtistRef[];
  album: string;
  albumId: string;
  /** Seconds. */
  duration: number;
  explicit: boolean;
  /** False only when Spotify said so for the user's market; unknown counts as playable. */
  playable: boolean;
  /** Largest cover Spotify listed for the album, when it listed any. */
  albumImage?: string;
  score: SpotifyTrackMatchScore;
  /** The query that surfaced this hit, for troubleshooting. */
  matchedQuery: string;
  /** The parsed hit, kept so callers can build a `SongSource` and an album image from it. */
  track: SpotifyTrackHit;
}

export interface SpotifyArtistMatch {
  /** The Spotify artist id, ready to be passed straight back into the API. */
  id: string;
  name: string;
  genres: string[];
  followers?: number;
  picture?: string;
}

/** One entry of an artist's discography, as `getArtistAlbums` reports it. */
export interface SpotifyAlbumMatch {
  id: string;
  title: string;
  /** `album`, `single` or `compilation`. */
  type: string;
  releaseDate?: string;
  trackCount?: number;
  image?: string;
  artists: SpotifyArtistRef[];
}

/* -------------------------------------------------------------------------- */
/* Artist-locked lookup                                                       */
/* -------------------------------------------------------------------------- */

export interface SpotifyArtistCatalogCriteria {
  /** The artist the lookup is locked to. Mandatory. */
  artist: string;
  /** An album by that artist, resolved against their own discography. */
  album?: string;
  /** A recording by that artist, searched with the artist filter and verified by id. */
  title?: string;
  /** Tracks reported at most. */
  limit?: number;
}

export interface SpotifyArtistCatalogResult {
  /** The artist the lookup locked on, or `null` when Spotify has no artist by that name. */
  artist: SpotifyArtistMatch | null;
  /** Every artist hit the name produced, for reporting namesakes. */
  candidates: SpotifyArtistMatch[];
  /** The discography of the locked artist. */
  albums: SpotifyAlbumMatch[];
  /** The album `criteria.album` resolved to, when it resolved. */
  matchedAlbum?: SpotifyAlbumMatch;
  albumScore?: number;
  /** The tracks found, verified to be the artist's. */
  tracks: SpotifyTrackMatch[];
  /** Where the tracks came from: the album's own tracklist, the filtered search, or nowhere. */
  source: 'album' | 'catalog' | 'none';
}
