import type { Search_RequestBody } from '@opensearch-project/opensearch/api/_core/search.js';

/** The body `client.search` accepts, so every query object type-checks against the API. */
export type SearchRequestBody = Search_RequestBody;

/** One clause of a `bool` query: the client's own query container type. */
export type QueryClause = NonNullable<SearchRequestBody['query']>;

export interface SearchQuery {
  getQuery(): SearchRequestBody;
}
