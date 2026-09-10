import { QueryClause, SearchQuery, SearchRequestBody } from './query.interface';

export class SearchSongQuery implements SearchQuery {
  constructor(
    private title: string,
    private album: string,
    private artist: string,
    private album_id?: string | null,
    private artist_id?: string | null,
  ) {}

  getQuery(): SearchRequestBody {
    const mustClauses: QueryClause[] = [
      {
        multi_match: {
          query: this.title,
          fields: ['title.keyword^5', 'title.normalizer', 'title.pinyin', 'title.romaji^2'],
          type: 'best_fields',
          operator: 'and',
          tie_breaker: 0.3,
        },
      },
    ];

    if (this.album_id) {
      mustClauses.push({
        term: {
          album_id: this.album_id,
        },
      });
    } else {
      mustClauses.push({
        multi_match: {
          query: this.album,
          fields: ['album.keyword^5', 'album.normalizer', 'album.pinyin', 'album.romaji^2'],
          type: 'best_fields',
          operator: 'and',
          tie_breaker: 0.3,
        },
      });
    }

    if (this.artist_id) {
      mustClauses.push({
        term: {
          artist_id: this.artist_id,
        },
      });
    } else {
      mustClauses.push({
        multi_match: {
          query: this.artist,
          fields: ['artist.keyword^5', 'artist.normalizer', 'artist.pinyin', 'artist.romaji^2'],
          type: 'best_fields',
          operator: 'and',
          tie_breaker: 0.3,
        },
      });
    }

    return {
      size: 10,
      query: {
        bool: {
          must: mustClauses,
        },
      },
    };
  }
}
