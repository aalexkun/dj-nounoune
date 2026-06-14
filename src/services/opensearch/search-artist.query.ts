import { SearchQuery } from './query.interface';

export class ArtistSearchQuery implements SearchQuery {
  constructor(private artist: string) {}

  getQuery(): Record<string, any> {
    return {
      size: 10,
      query: {
        multi_match: {
          query: this.artist,
          fields: ['artist.keyword^5', 'artist.normalizer', 'artist.pinyin', 'artist.romaji^2'],
          type: 'best_fields',
          operator: 'and',
          tie_breaker: 0.3,
        },
      },
      aggs: {
        artist_id: {
          terms: {
            field: 'artist_id',
            size: 20,
          },
        },
      },
    };
  }
}
