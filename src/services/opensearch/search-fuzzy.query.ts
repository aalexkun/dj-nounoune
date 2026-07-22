import { SearchQuery } from './query.interface';

export class SearchFuzzyQuery implements SearchQuery {
  constructor(
    private keywords: string[],
    private modelId: string,
    private size: number = 100,
  ) {}

  getQuery(): Record<string, any> {
    const keywordList = Array.isArray(this.keywords) ? this.keywords : [this.keywords];

    const textFieldGroups = [
      ['title.keyword', 'title.normalizer', 'title.pinyin', 'title.romaji^2'],
      ['album.keyword', 'album.normalizer', 'album.pinyin', 'album.romaji^2'],
      ['artist.keyword', 'artist.normalizer', 'artist.pinyin', 'artist.romaji^2'],
    ];

    const shouldClauses: any[] = [];

    for (const kw of keywordList) {
      for (const fields of textFieldGroups) {
        shouldClauses.push({
          multi_match: {
            query: kw,
            fields,
            type: 'best_fields',
            operator: 'and',
            tie_breaker: 0.3,
          },
        });
      }

      // Semantic match on the vector, weighted down
      shouldClauses.push({
        neural: {
          song_vector: {
            query_text: kw,
            model_id: this.modelId, // deployed model id for paraphrase-multilingual-MiniLM-L12-v2
            k: 50,
            boost: 0.3, // reduce weight vs. lexical matches
          },
        },
      });
    }

    return {
      size: this.size,
      query: {
        bool: {
          should: shouldClauses,
          minimum_should_match: 1,
        },
      },
    };
  }
}
