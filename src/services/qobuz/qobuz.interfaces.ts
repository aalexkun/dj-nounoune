import { z } from 'zod';

/**
 * Optional in the way Qobuz actually behaves.
 *
 * The API is inconsistent about absence: a field it has no value for may be
 * missing from the payload, or present and `null`, with no pattern to it —
 * `copyright` came back `null` on 2 of 287 sampled search hits, `version` on
 * 173 of them. A plain `.optional()` rejects the null, which meant a single
 * null field discarded an otherwise perfectly good search result.
 *
 * Both forms are accepted and normalised to `undefined`, so the hand-written
 * interfaces below stay honest about what callers actually receive.
 */
function qobuzOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined);
}

export const QobuzErrorResponseSchema = z.object({
  status: z.literal('error'),
  message: z.string(),
  code: z.coerce.string(),
});
export type QobuzErrorResponse = z.infer<typeof QobuzErrorResponseSchema>;

export const QobuzLoginResponseSchema = z.object({
  user: z.object({
    id: z.number(),
    email: z.string(),
    public_id: z.string(),
  }),
  user_auth_token: z.string(),
});
export type QobuzLoginResponse = z.infer<typeof QobuzLoginResponseSchema>;

export const QobuzImageSchema = z.object({
  small: qobuzOptional(z.string()),
  thumbnail: qobuzOptional(z.string()),
  large: qobuzOptional(z.string()),
  back: qobuzOptional(z.string()),
});
export type QobuzImage = z.infer<typeof QobuzImageSchema>;

export const QobuzGenreSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: qobuzOptional(z.string()),
  slug: qobuzOptional(z.string()),
  path: qobuzOptional(z.array(z.number())),
});
export type QobuzGenre = z.infer<typeof QobuzGenreSchema>;

export const QobuzLabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  albums_count: qobuzOptional(z.number()),
  supplier_id: qobuzOptional(z.number()),
  slug: qobuzOptional(z.string()),
});
export type QobuzLabel = z.infer<typeof QobuzLabelSchema>;

/**
 * The cover block `/catalog/search?type=artists` puts on an artist. Different sizes from
 * {@link QobuzImageSchema}, which is the album one.
 */
export const QobuzArtistImageSchema = z.object({
  small: qobuzOptional(z.string()),
  medium: qobuzOptional(z.string()),
  large: qobuzOptional(z.string()),
  extralarge: qobuzOptional(z.string()),
  mega: qobuzOptional(z.string()),
});
export type QobuzArtistImage = z.infer<typeof QobuzArtistImageSchema>;

export const QobuzArtistSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: qobuzOptional(z.string()),
  picture: qobuzOptional(z.string()),
  /**
   * A url when the artist is nested in an album or a track — but the artist *search* answers with
   * a block of sizes instead, and declaring only the string quietly failed the whole hit. It cost
   * the real Spice: searching her name returned Warren C. Spicer, because she was the one hit the
   * schema threw away and every other artist in that page happened to have no cover at all.
   */
  image: qobuzOptional(z.union([z.string(), QobuzArtistImageSchema])),
  albums_count: qobuzOptional(z.number()),
});
export type QobuzArtist = z.infer<typeof QobuzArtistSchema>;

export const QobuzAlbumArtistRefSchema = z.object({
  id: z.number(),
  name: z.string(),
  roles: qobuzOptional(z.array(z.string())),
});
export type QobuzAlbumArtistRef = z.infer<typeof QobuzAlbumArtistRefSchema>;

export const QobuzPerformerSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type QobuzPerformer = z.infer<typeof QobuzPerformerSchema>;

export const QobuzAudioInfoSchema = z.object({
  replaygain_track_peak: qobuzOptional(z.number()),
  replaygain_track_gain: qobuzOptional(z.number()),
});
export type QobuzAudioInfo = z.infer<typeof QobuzAudioInfoSchema>;

export interface QobuzTrack {
  id: number;
  title: string;
  version?: string | null;
  duration: number;
  media_number: number;
  track_number: number;
  isrc?: string;
  copyright?: string;
  performers?: string;
  performer?: QobuzPerformer;
  composer?: QobuzPerformer;
  work?: string | null;
  audio_info?: QobuzAudioInfo;
  release_date_original?: string;
  release_date_download?: string;
  release_date_stream?: string;
  release_date_purchase?: string;
  maximum_bit_depth: number;
  maximum_sampling_rate: number;
  maximum_channel_count?: number;
  parental_warning?: boolean;
  purchasable?: boolean;
  streamable?: boolean;
  previewable?: boolean;
  sampleable?: boolean;
  downloadable?: boolean;
  displayable?: boolean;
  hires?: boolean;
  hires_streamable?: boolean;
  album?: QobuzAlbum;
}

export interface QobuzAlbumTracks {
  offset?: number;
  limit?: number;
  total?: number;
  items: QobuzTrack[];
}

export interface QobuzAlbum {
  id: string;
  qobuz_id?: number;
  title: string;
  version?: string | null;
  subtitle?: string;
  description?: string;
  artist: QobuzArtist;
  artists?: QobuzAlbumArtistRef[];
  composer?: QobuzArtist;
  label?: QobuzLabel;
  genre?: QobuzGenre;
  genres_list?: string[];
  image?: QobuzImage;
  upc?: string;
  url?: string;
  slug?: string;
  duration?: number;
  tracks_count?: number;
  media_count?: number;
  popularity?: number;
  parental_warning?: boolean;
  released_at?: number;
  release_date_original?: string;
  release_date_download?: string;
  release_date_stream?: string;
  release_type?: string;
  product_type?: string;
  maximum_bit_depth?: number;
  maximum_sampling_rate?: number;
  maximum_channel_count?: number;
  maximum_technical_specifications?: string;
  hires?: boolean;
  hires_streamable?: boolean;
  purchasable?: boolean;
  streamable?: boolean;
  previewable?: boolean;
  sampleable?: boolean;
  downloadable?: boolean;
  displayable?: boolean;
  is_official?: boolean;
  copyright?: string;
  tracks?: QobuzAlbumTracks;
}

export const QobuzAlbumSchema: z.ZodType<QobuzAlbum> = z.lazy(() =>
  z.object({
    id: z.string(),
    qobuz_id: qobuzOptional(z.number()),
    title: z.string(),
    version: qobuzOptional(z.string()),
    subtitle: qobuzOptional(z.string()),
    description: qobuzOptional(z.string()),
    artist: QobuzArtistSchema,
    artists: qobuzOptional(z.array(QobuzAlbumArtistRefSchema)),
    composer: qobuzOptional(QobuzArtistSchema),
    label: qobuzOptional(QobuzLabelSchema),
    genre: qobuzOptional(QobuzGenreSchema),
    genres_list: qobuzOptional(z.array(z.string())),
    image: qobuzOptional(QobuzImageSchema),
    upc: qobuzOptional(z.string()),
    url: qobuzOptional(z.string()),
    slug: qobuzOptional(z.string()),
    duration: qobuzOptional(z.number()),
    tracks_count: qobuzOptional(z.number()),
    media_count: qobuzOptional(z.number()),
    popularity: qobuzOptional(z.number()),
    parental_warning: qobuzOptional(z.boolean()),
    released_at: qobuzOptional(z.number()),
    release_date_original: qobuzOptional(z.string()),
    release_date_download: qobuzOptional(z.string()),
    release_date_stream: qobuzOptional(z.string()),
    release_type: qobuzOptional(z.string()),
    product_type: qobuzOptional(z.string()),
    maximum_bit_depth: qobuzOptional(z.number()),
    maximum_sampling_rate: qobuzOptional(z.number()),
    maximum_channel_count: qobuzOptional(z.number()),
    maximum_technical_specifications: qobuzOptional(z.string()),
    hires: qobuzOptional(z.boolean()),
    hires_streamable: qobuzOptional(z.boolean()),
    purchasable: qobuzOptional(z.boolean()),
    streamable: qobuzOptional(z.boolean()),
    previewable: qobuzOptional(z.boolean()),
    sampleable: qobuzOptional(z.boolean()),
    downloadable: qobuzOptional(z.boolean()),
    displayable: qobuzOptional(z.boolean()),
    is_official: qobuzOptional(z.boolean()),
    copyright: qobuzOptional(z.string()),
    tracks: qobuzOptional(QobuzAlbumTracksSchema),
  }),
);

export const QobuzTrackSchema: z.ZodType<QobuzTrack> = z.lazy(() =>
  z.object({
    id: z.number(),
    title: z.string(),
    version: qobuzOptional(z.string()),
    duration: z.number(),
    media_number: z.number(),
    track_number: z.number(),
    isrc: qobuzOptional(z.string()),
    copyright: qobuzOptional(z.string()),
    performers: qobuzOptional(z.string()),
    performer: qobuzOptional(QobuzPerformerSchema),
    composer: qobuzOptional(QobuzPerformerSchema),
    work: qobuzOptional(z.string()),
    audio_info: qobuzOptional(QobuzAudioInfoSchema),
    release_date_original: qobuzOptional(z.string()),
    release_date_download: qobuzOptional(z.string()),
    release_date_stream: qobuzOptional(z.string()),
    release_date_purchase: qobuzOptional(z.string()),
    maximum_bit_depth: z.number(),
    maximum_sampling_rate: z.number(),
    maximum_channel_count: qobuzOptional(z.number()),
    parental_warning: qobuzOptional(z.boolean()),
    purchasable: qobuzOptional(z.boolean()),
    streamable: qobuzOptional(z.boolean()),
    previewable: qobuzOptional(z.boolean()),
    sampleable: qobuzOptional(z.boolean()),
    downloadable: qobuzOptional(z.boolean()),
    displayable: qobuzOptional(z.boolean()),
    hires: qobuzOptional(z.boolean()),
    hires_streamable: qobuzOptional(z.boolean()),
    album: qobuzOptional(QobuzAlbumSchema),
  }),
);

export const QobuzAlbumTracksSchema: z.ZodType<QobuzAlbumTracks> = z.lazy(() =>
  z.object({
    offset: qobuzOptional(z.number()),
    limit: qobuzOptional(z.number()),
    total: qobuzOptional(z.number()),
    items: z.array(QobuzTrackSchema),
  }),
);

export const QobuzUserFavoritesResponseSchema = z.object({
  tracks: qobuzOptional(
    z.object({
      limit: z.number(),
      offset: z.number(),
      total: z.number(),
      items: z.array(QobuzTrackSchema),
    }),
  ),
  albums: qobuzOptional(
    z.object({
      limit: z.number(),
      offset: z.number(),
      total: z.number(),
      items: z.array(QobuzAlbumSchema),
    }),
  ),
});
export type QobuzUserFavoritesResponse = z.infer<typeof QobuzUserFavoritesResponseSchema>;

/**
 * Catalog search response, restricted to the `tracks` bucket.
 *
 * Items stay `unknown` on purpose: the search endpoint returns a slightly
 * leaner track payload than `/track/get`, and a single unexpected item must not
 * fail the whole page. `QobuzService.searchTracks` re-parses each item with
 * `QobuzTrackSchema` and skips the ones that do not validate.
 */
export const QobuzTrackSearchResponseSchema = z.object({
  query: qobuzOptional(z.string()),
  tracks: qobuzOptional(
    z.object({
      limit: qobuzOptional(z.number()),
      offset: qobuzOptional(z.number()),
      total: qobuzOptional(z.number()),
      items: z.array(z.unknown()),
    }),
  ),
});
export type QobuzTrackSearchResponse = z.infer<typeof QobuzTrackSearchResponseSchema>;

/**
 * Catalog search response, restricted to the `artists` bucket.
 *
 * Items stay `unknown` for the same reason as the track bucket: one unexpected payload must not
 * discard the whole page. {@link QobuzService.searchArtists} re-parses each item and skips the
 * ones that do not validate.
 */
export const QobuzArtistSearchResponseSchema = z.object({
  query: qobuzOptional(z.string()),
  artists: qobuzOptional(
    z.object({
      limit: qobuzOptional(z.number()),
      offset: qobuzOptional(z.number()),
      total: qobuzOptional(z.number()),
      items: z.array(z.unknown()),
    }),
  ),
});
export type QobuzArtistSearchResponse = z.infer<typeof QobuzArtistSearchResponseSchema>;

/**
 * An album as `/artist/get?extra=albums` reports it — leaner than {@link QobuzAlbumSchema}, which
 * would reject these items outright because the discography omits the `artist` block it requires.
 */
export const QobuzArtistAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: qobuzOptional(z.string()),
  release_date_original: qobuzOptional(z.string()),
  tracks_count: qobuzOptional(z.number()),
  hires: qobuzOptional(z.boolean()),
  streamable: qobuzOptional(z.boolean()),
});
export type QobuzArtistAlbum = z.infer<typeof QobuzArtistAlbumSchema>;

/**
 * `/artist/get`. Only the fields the lookup tool reports are declared — Zod ignores the rest, which
 * keeps this from breaking every time Qobuz adds a block to the artist page.
 */
export const QobuzArtistDetailSchema = z.object({
  id: z.number(),
  name: z.string(),
  albums_count: qobuzOptional(z.number()),
  albums: qobuzOptional(
    z.object({
      limit: qobuzOptional(z.number()),
      offset: qobuzOptional(z.number()),
      total: qobuzOptional(z.number()),
      items: z.array(z.unknown()),
    }),
  ),
});
export type QobuzArtistDetail = z.infer<typeof QobuzArtistDetailSchema>;

/** `/favorite/create` and `/favorite/delete` answer with nothing but a status. */
export const QobuzFavoriteResponseSchema = z.object({
  status: qobuzOptional(z.string()),
});
export type QobuzFavoriteResponse = z.infer<typeof QobuzFavoriteResponseSchema>;

/** A catalog artist hit, flattened to what a caller usually needs. */
export interface QobuzArtistMatch {
  /** The Qobuz artist id, as a string so it can be passed straight back into the API. */
  id: string;
  name: string;
  albumsCount?: number;
  picture?: string;
}

/** What can be added to the Qobuz favourites in one call. At least one list must be non-empty. */
export interface QobuzFavoriteInput {
  trackIds?: string[];
  albumIds?: string[];
  artistIds?: string[];
}

/**
 * What the caller knows about a recording they want, when they also know whose it is.
 *
 * The artist is mandatory here — that is the whole difference from {@link QobuzTrackSearchCriteria}.
 * It is resolved to a Qobuz artist id before anything else happens, and every track handed back is
 * verified against that id, so the search cannot wander off to another performer.
 */
export interface QobuzArtistCatalogCriteria {
  /** Artist name, spelled as the user gave it. Resolved to an id, then used as a hard filter. */
  artist: string;
  /** Optional album title, resolved against the artist's own discography. */
  album?: string;
  /** Optional track title. Without an album this narrows the catalog search; with one it picks tracks off the tracklist. */
  title?: string;
  /** Maximum tracks handed back. Defaults to the whole album, or 25 catalog hits. */
  limit?: number;
}

/** Where the tracks in a {@link QobuzArtistCatalogResult} came from, so callers can say so honestly. */
export type QobuzArtistCatalogSource = 'album' | 'catalog' | 'none';

/** The answer to an artist-locked lookup: who was found, what they released, and which tracks match. */
export interface QobuzArtistCatalogResult {
  /** The artist the lookup locked onto, or null when the catalog holds nobody by that name. */
  artist: QobuzArtistMatch | null;
  /** Every artist the name matched, best first, so a common name can still be disambiguated. */
  candidates: QobuzArtistMatch[];
  /** The artist's discography as Qobuz reports it. Empty when the artist was not found. */
  albums: QobuzArtistAlbum[];
  /** The discography entry the album criterion resolved to, when one was given and one matched. */
  matchedAlbum?: QobuzArtistAlbum;
  /** How well {@link matchedAlbum} matched what was asked for, in [0, 1]. */
  albumScore?: number;
  /** Matching tracks, all guaranteed to be the artist's own. */
  tracks: QobuzTrackMatch[];
  source: QobuzArtistCatalogSource;
}

/** What the caller knows about the track they are looking for. */
export interface QobuzTrackSearchCriteria {
  /** Track title. The only mandatory criterion. */
  title: string;
  /** Performing artist, used both to narrow the query and to rank results. */
  artist?: string;
  /** Album title, used both to narrow the query and to rank results. */
  album?: string;
  /** Maximum number of items requested per catalog query. Defaults to 25. */
  limit?: number;
  /**
   * Return every hit seen, including the ones that fail a stated criterion. For debugging what the
   * catalog actually answered; never for a caller that will act on the result.
   */
  includeRejected?: boolean;
}

/** Per-criterion breakdown of how well a candidate matched, each in [0, 1]. */
export interface QobuzTrackMatchScore {
  total: number;
  title: number;
  artist: number;
  album: number;
}

/** A catalog search hit, flattened to the fields a caller usually needs. */
export interface QobuzTrackMatch {
  /** The Qobuz track id — what the search is ultimately after. */
  id: string;
  title: string;
  version?: string;
  artist: string;
  album: string;
  albumId?: string;
  duration: number;
  hires: boolean;
  streamable: boolean;
  score: QobuzTrackMatchScore;
  /** The query that surfaced this hit, for troubleshooting. */
  matchedQuery: string;
  /** The raw track, kept so callers can build a `SongSource` from it. */
  track: QobuzTrack;
}
