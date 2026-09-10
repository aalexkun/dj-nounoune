import { QueryClause, SearchQuery, SearchRequestBody } from './query.interface';
import { buildActiveSourceFilter } from './source-filter.util';

/**
 * Lexical lookup of artists, albums and titles across the multilingual analysers.
 *
 * Deliberately no neural clause: `song_vector` embeds what a song is *about*, not what it is
 * called, and scoring a name against it is noise. Identity matching belongs to the analysed text
 * fields, which is also why this query works on a cluster with no ML model deployed.
 */
export class SearchFuzzyQuery implements SearchQuery {
  /**
   * @param activeSources - source types the agentic client may play, or `null` for no restriction.
   *   Applied as a `filter` clause so it is score-neutral.
   */
  constructor(
    private keywords: string[],
    private size: number = 100,
    private activeSources: string[] | null = null,
  ) {}

  getQuery(): SearchRequestBody {
    const keywordList = Array.isArray(this.keywords) ? this.keywords : [this.keywords];

    const textFieldGroups = [
      ['title.keyword', 'title.normalizer', 'title.pinyin', 'title.romaji^2'],
      ['album.keyword', 'album.normalizer', 'album.pinyin', 'album.romaji^2'],
      ['artist.keyword', 'artist.normalizer', 'artist.pinyin', 'artist.romaji^2'],
    ];

    const shouldClauses: QueryClause[] = [];

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
    }

    const sourceFilter = buildActiveSourceFilter(this.activeSources);

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
