import { DuplicateSongCheck } from './opensearch.service';
import { SearchQuery, SearchRequestBody } from './query.interface';

/**
 * Purely lexical. The `boost: 100` on the match clause is a contract, not a tuning knob: the
 * dedup CLI and the Qobuz and YouTube importers all read `_score >= 100` as "same recording",
 * and the importers insert a second copy of the song for anything below it. Leave the clause
 * exactly as it is.
 */
export class SearchDeduplicationSongQuery implements SearchQuery {
  constructor(private songAttributes: DuplicateSongCheck) {}

  getQuery(): SearchRequestBody {
    const mustNotClause = this.songAttributes.songId
      ? [
          {
            term: {
              _id: this.songAttributes.songId,
            },
          },
        ]
      : [];

    return {
      size: 10,
      query: {
        bool: {
          must_not: mustNotClause,
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
          ],
        },
      },
    };
  }
}
