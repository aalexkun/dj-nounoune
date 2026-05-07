export interface QobuzErrorResponse {
  status: 'error';
  message: string;
  code: string;
}

export interface QobuzLoginResponse {
  user: {
    id: number;
    email: string;
    public_id: string;
  };
  user_auth_token: string;
}

export interface QobuzUserFavoritesResponse {
  tracks?: {
    limit: number;
    offset: number;
    total: number;
    items: QobuzTrack[];
  };
  albums?: {
    limit: number;
    offset: number;
    total: number;
    items: QobuzAlbum[];
  };
}

export interface QobuzTrack {
  id: number;
  title: string;
  duration: number;
  media_number: number;
  track_number: number;
  release_date_original: string;
  release_date_stream: string;
  album: QobuzAlbum;
  performer: QobuzPerformer;
  composer?: QobuzPerformer;
  maximum_bit_depth: number;
  maximum_sampling_rate: number;
  [key: string]: any;
}

export interface QobuzAlbum {
  id: string;
  title: string;
  artist: QobuzPerformer;
  release_date_original: string;
  release_date_stream: string;
  upc: string;
  tracks_count: number;
  genre: QobuzGenre;
  image: {
    small: string;
    thumbnail: string;
    large: string;
    back: string;
  };
  tracks?: {
    items: QobuzTrack[];
  };
  [key: string]: any;
}

export interface QobuzPerformer {
  id: number;
  name: string;
  [key: string]: any;
}

export interface QobuzGenre {
  id: number;
  name: string;
  color: string;
  path: number[];
}
