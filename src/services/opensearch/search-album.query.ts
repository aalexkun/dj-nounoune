import { SearchQuery } from './query.interface';

export class AlbumSearchQuery implements SearchQuery {
  constructor(
    private album: string,
  ) {}

  getQuery(): Record<string, any> {
    return {
      size: 10,
      query: {
        multi_match: {
          query: this.album,
          fields: ['album.keyword^5', 'album.normalizer', 'album.pinyin', 'album.romaji^2'],
          type: 'best_fields',
          operator: 'and',
          tie_breaker: 0.3,
        },
      },
      aggs: {
        album_id: {
          terms: {
            field: 'album_id',
            size: 20,
          },
        },
      },
    };
  }
}
