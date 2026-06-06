import { SearchQuery } from './query.interface';

export class AlbumSearchQuery implements SearchQuery {
  constructor(
    private album: string,
    private modelId: string,
  ) {}

  getQuery(): Record<string, any> {
    return {
      size: 10,
      query: {
        bool: {
          should: [
            {
              multi_match: {
                query: `"""${this.album}"""`,
                fields: ['album.keyword^5', 'album.normalizer', 'album.pinyin', 'album.romaji^2'],
                type: 'best_fields',
                operator: 'and',
                tie_breaker: 0.3,
              },
            },
            {
              neural: {
                song_vector: {
                  query_text: `"""${this.album}"""`,
                  model_id: this.modelId,
                  k: 5,
                },
              },
            },
          ],
        },
      },
    };
  }
}
