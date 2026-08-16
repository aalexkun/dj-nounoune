import { SearchQuery } from './query.interface';

export class SearchFuzzyQuery implements SearchQuery {
  /**
   * @param activeSources - source types the agentic client may play, or `null` for no restriction.
   *   Applied as a `filter` clause so it is score-neutral.
   */
  constructor(
    private keywords: string[],
    private modelId: string,
    private size: number = 100,
    private activeSources: string[] | null = null,
  ) {}

  /**
   * Documents indexed incrementally by the importers carry no `source` array at all - only the
   * full reindex writes it. Excluding them here would hide most of the recent library, so they are
   * let through and the caller re-checks them against Mongo, which is the authority.
   */
  private buildSourceFilter(): Record<string, any>[] {
    if (!this.activeSources || this.activeSources.length === 0) {
      return [];
    }

    return [
      {
        bool: {
          should: [
            { terms: { 'source.name': this.activeSources } },
            { bool: { must_not: { exists: { field: 'source.name' } } } },
          ],
          minimum_should_match: 1,
        },
      },
    ];
  }

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

    const sourceFilter = this.buildSourceFilter();

    return {
      size: this.size,
      query: {
        bool: {
          should: shouldClauses,
          minimum_should_match: 1,
          ...(sourceFilter.length > 0 ? { filter: sourceFilter } : {}),
        },
      },
    };
  }
}
