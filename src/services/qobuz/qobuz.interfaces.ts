import { z } from 'zod';

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
  small: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  large: z.string().nullable().optional(),
  back: z.string().nullable().optional(),
});
export type QobuzImage = z.infer<typeof QobuzImageSchema>;

export const QobuzGenreSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string().optional(),
  slug: z.string().optional(),
  path: z.array(z.number()).optional(),
});
export type QobuzGenre = z.infer<typeof QobuzGenreSchema>;

export const QobuzLabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  albums_count: z.number().optional(),
  supplier_id: z.number().optional(),
  slug: z.string().optional(),
});
export type QobuzLabel = z.infer<typeof QobuzLabelSchema>;

export const QobuzArtistSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string().optional(),
  picture: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  albums_count: z.number().optional(),
});
export type QobuzArtist = z.infer<typeof QobuzArtistSchema>;

export const QobuzAlbumArtistRefSchema = z.object({
  id: z.number(),
  name: z.string(),
  roles: z.array(z.string()).optional(),
});
export type QobuzAlbumArtistRef = z.infer<typeof QobuzAlbumArtistRefSchema>;

export const QobuzPerformerSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type QobuzPerformer = z.infer<typeof QobuzPerformerSchema>;

export const QobuzAudioInfoSchema = z.object({
  replaygain_track_peak: z.number().optional(),
  replaygain_track_gain: z.number().optional(),
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
    qobuz_id: z.number().optional(),
    title: z.string(),
    version: z.string().nullable().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    artist: QobuzArtistSchema,
    artists: z.array(QobuzAlbumArtistRefSchema).optional(),
    composer: QobuzArtistSchema.optional(),
    label: QobuzLabelSchema.optional(),
    genre: QobuzGenreSchema.optional(),
    genres_list: z.array(z.string()).optional(),
    image: QobuzImageSchema.optional(),
    upc: z.string().optional(),
    url: z.string().optional(),
    slug: z.string().optional(),
    duration: z.number().optional(),
    tracks_count: z.number().optional(),
    media_count: z.number().optional(),
    popularity: z.number().optional(),
    parental_warning: z.boolean().optional(),
    released_at: z.number().optional(),
    release_date_original: z.string().optional(),
    release_date_download: z.string().optional(),
    release_date_stream: z.string().optional(),
    release_type: z.string().optional(),
    product_type: z.string().optional(),
    maximum_bit_depth: z.number().optional(),
    maximum_sampling_rate: z.number().optional(),
    maximum_channel_count: z.number().optional(),
    maximum_technical_specifications: z.string().optional(),
    hires: z.boolean().optional(),
    hires_streamable: z.boolean().optional(),
    purchasable: z.boolean().optional(),
    streamable: z.boolean().optional(),
    previewable: z.boolean().optional(),
    sampleable: z.boolean().optional(),
    downloadable: z.boolean().optional(),
    displayable: z.boolean().optional(),
    is_official: z.boolean().optional(),
    copyright: z.string().optional(),
    tracks: QobuzAlbumTracksSchema.optional(),
  })
);

export const QobuzTrackSchema: z.ZodType<QobuzTrack> = z.lazy(() =>
  z.object({
    id: z.number(),
    title: z.string(),
    version: z.string().nullable().optional(),
    duration: z.number(),
    media_number: z.number(),
    track_number: z.number(),
    isrc: z.string().optional(),
    copyright: z.string().optional(),
    performers: z.string().optional(),
    performer: QobuzPerformerSchema.optional(),
    composer: QobuzPerformerSchema.optional(),
    work: z.string().nullable().optional(),
    audio_info: QobuzAudioInfoSchema.optional(),
    release_date_original: z.string().optional(),
    release_date_download: z.string().optional(),
    release_date_stream: z.string().optional(),
    release_date_purchase: z.string().optional(),
    maximum_bit_depth: z.number(),
    maximum_sampling_rate: z.number(),
    maximum_channel_count: z.number().optional(),
    parental_warning: z.boolean().optional(),
    purchasable: z.boolean().optional(),
    streamable: z.boolean().optional(),
    previewable: z.boolean().optional(),
    sampleable: z.boolean().optional(),
    downloadable: z.boolean().optional(),
    displayable: z.boolean().optional(),
    hires: z.boolean().optional(),
    hires_streamable: z.boolean().optional(),
    album: QobuzAlbumSchema.optional(),
  })
);

export const QobuzAlbumTracksSchema: z.ZodType<QobuzAlbumTracks> = z.lazy(() =>
  z.object({
    offset: z.number().optional(),
    limit: z.number().optional(),
    total: z.number().optional(),
    items: z.array(QobuzTrackSchema),
  })
);

export const QobuzUserFavoritesResponseSchema = z.object({
  tracks: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
    items: z.array(QobuzTrackSchema),
  }).optional(),
  albums: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
    items: z.array(QobuzAlbumSchema),
  }).optional(),
});
export type QobuzUserFavoritesResponse = z.infer<typeof QobuzUserFavoritesResponseSchema>;
