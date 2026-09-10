import { QueryClause, SearchQuery, SearchRequestBody } from './query.interface';

/** What the recall query is given. */
export interface DuplicateCandidateCriteria {
  /** The song to exclude from its own results. */
  songId?: string;
  /** Title with version qualifiers and featured credits removed, for the fuzzy clauses. */
  title: string;
  /** Artist without a featured credit, for the fuzzy clauses. */
  artist: string;
  /** The title exactly as stored, for the exact clause. */
  rawTitle?: string;
  /** The artist exactly as stored, for the exact clause. */
  rawArtist?: string;
  /** The album document the song belongs to; candidates on the same one are ranked first. */
  albumId?: string;
  /** Every ISRC the song's sources report. */
  isrcs?: string[];
  size?: number;
}

/**
 * Lucene rewrites a fuzzy term into every indexed term within edit distance, per field, and
 * refuses a query past `indices.query.bool.max_clause_count` (1,024). A twenty-token classical
 * title, fuzzy over five subfields at the default fifty expansions each, is five thousand
 * clauses — which is exactly what took the cluster down once the recreated index carried every
 * subfield. So the budget is bounded on three sides: fuzziness only on the two folding subfields,
 * at most ten expansions per term with the first letter fixed, and no fuzziness at all on a
 * value with more tokens than this — a long title is distinctive enough exact.
 */
const FUZZY_TOKEN_LIMIT = 12;
const FUZZY_MAX_EXPANSIONS = 10;

/**
 * One analysed value, searched two ways and either is enough.
 *
 * Several readings of the same text on purpose, so that the recall does not hinge on one
 * analyzer's idea of a name: `icu` transliterates every script and keeps symbols, `identity`
 * folds accents without any plugin, `normalizer` is the plain tokenised text, `pinyin` and
 * `romaji` are the Chinese and Japanese readings. Fuzziness rides on the two folding readings
 * only; the other three are matched on exact tokens. On an index created before a subfield
 * existed that subfield matches nothing and the others carry the query.
 */
function valueClause(field: 'title' | 'artist', query: string): QueryClause {
  const tokens = query.split(/\s+/).filter((token) => token.length > 0).length;

  return {
    bool: {
      should: [
        {
          multi_match: {
            query,
            fields: [`${field}.icu^2`, `${field}.identity^2`],
            type: 'best_fields',
            fuzziness: tokens <= FUZZY_TOKEN_LIMIT ? 'AUTO' : '0',
            prefix_length: 1,
            max_expansions: FUZZY_MAX_EXPANSIONS,
            minimum_should_match: '2<75%',
            tie_breaker: 0.3,
          },
        },
        {
          multi_match: {
            query,
            fields: [`${field}.normalizer`, `${field}.pinyin`, `${field}.romaji`],
            type: 'best_fields',
            minimum_should_match: '2<75%',
            tie_breaker: 0.3,
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

/**
 * The recall half of deduplication: every song that *might* be the same recording.
 *
 * Deliberately loose, and never read as a verdict — the deterministic scorer in
 * `duplicate-score.util.ts` decides what to do with each hit. So the album is not a clause at
 * all (a deluxe edition or a compilation copy must come back to be judged), a quarter of the
 * title's tokens may be missing (`Title (Remastered 2009)` still finds `Title`), and the
 * fuzziness absorbs the one-character gaps the analyzers cannot.
 *
 * Three ways in, any one of which is enough:
 *  - the fuzzy title *and* artist clauses above;
 *  - the exact title *and* artist, whole-string and case-insensitive, on the `exact` subfield.
 *    This is the route for names the tokenizers destroy — `/\/\/\ Y /\` analyses to `y`,
 *    `bbno$` to `bbno` — and it is why "the usual full-text index" is not enough here;
 *  - a shared ISRC.
 *
 * Candidates on the same album document are ranked first: the song, its album and its artist
 * are one identity, and a copy on the same record is the likeliest duplicate of all.
 */
export class SearchDuplicateCandidatesQuery implements SearchQuery {
  constructor(private readonly criteria: DuplicateCandidateCriteria) {}

  getQuery(): SearchRequestBody {
    const fuzzy: QueryClause[] = [valueClause('title', this.criteria.title)];

    if (this.criteria.artist) {
      fuzzy.push(valueClause('artist', this.criteria.artist));
    }

    const routes: QueryClause[] = [{ bool: { must: fuzzy } }];

    const rawTitle = this.criteria.rawTitle?.trim();
    const rawArtist = this.criteria.rawArtist?.trim();

    if (rawTitle) {
      const exact: QueryClause[] = [{ term: { 'title.exact': rawTitle } }];

      if (rawArtist) {
        exact.push({ term: { 'artist.exact': rawArtist } });
      }

      routes.push({ bool: { must: exact } });
    }

    const isrcs = (this.criteria.isrcs ?? []).filter((isrc) => !!isrc);

    if (isrcs.length > 0) {
      routes.push({ terms: { 'source.isrc.keyword': isrcs } });
    }

    return {
      size: this.criteria.size ?? 20,
      query: {
        bool: {
          must_not: this.criteria.songId ? [{ term: { _id: this.criteria.songId } }] : [],
          must: [{ bool: { should: routes, minimum_should_match: 1 } }],
          should: this.criteria.albumId ? [{ term: { album_id: { value: this.criteria.albumId, boost: 2 } } }] : [],
        },
      },
    };
  }
}
