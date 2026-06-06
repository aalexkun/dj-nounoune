import { DuplicateSongCheck } from './opensearch.service';
import { SearchQuery } from './query.interface';



export class SearchSongQuery implements SearchQuery {
  constructor(
    private songAttributes: DuplicateSongCheck,
    private modelId: string,
  ) {}

  // fix the return to work with the new query
  getQuery(): Record<string, any> {
    return {
      size: 10,
      query: {
        bool: {
          must_not: [
            {
              term: {
                _id: this.songAttributes.songId,
              },
            },
          ],
          should: [
            {
              bool: {
                boost: 100,
                must: [
                  {
                    multi_match: {
                      query: `"""${this.songAttributes.artist}"""`,
                      fields: ['artist.keyword^5', 'artist.normalizer', 'artist.pinyin', 'artist.romaji^2'],
                      type: 'best_fields',
                      operator: 'and',
                      tie_breaker: 0.3,
                    },
                  },
                  {
                    multi_match: {
                      query: `"""${this.songAttributes.album}"""`,
                      fields: ['album.keyword^5', 'album.normalizer', 'album.pinyin', 'album.romaji^2'],
                      type: 'best_fields',
                      operator: 'and',
                      tie_breaker: 0.3,
                    },
                  },
                  {
                    bool: {
                      must: [
                        {
                          multi_match: {
                            query: `"""${this.songAttributes.title}"""`,
                            fields: ['title.keyword^5', 'title.normalizer', 'title.pinyin', 'title.romaji^2'],
                            type: 'best_fields',
                            operator: 'and',
                            tie_breaker: 0.3,
                          },
                        },
                        {
                          bool: {
                            minimum_should_match: 1,
                            should: [
                              {
                                term: {
                                  track_number: this.songAttributes.track_number,
                                },
                              },
                              {
                                term: {
                                  track_number: 0,
                                },
                              },
                              {
                                bool: {
                                  must_not: {
                                    exists: {
                                      field: 'track_number',
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              neural: {
                song_vector: {
                  query_text: `"""${this.songAttributes.artist} ${this.songAttributes.album} (track ${this.songAttributes.track_number}) ${this.songAttributes.title}"""`,
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

