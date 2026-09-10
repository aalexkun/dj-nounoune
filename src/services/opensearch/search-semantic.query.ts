import { SearchQuery, SearchRequestBody } from './query.interface';
import { buildActiveSourceFilter } from './source-filter.util';

/**
 * kNN over `song_vector` — the embedding of each song's lyric distillation. `text` must be a
 * sentence in the same register as those distillations (the query generator produces it); a song
 * with no vector yet never matches, which is the right outcome for an un-enriched song.
 */
export class SearchSemanticQuery implements SearchQuery {
  /**
   * @param activeSources - source types the agentic client may play, or `null` for no restriction.
   */
  constructor(
    private text: string,
    private modelId: string,
    private size: number = 20,
    private activeSources: string[] | null = null,
  ) {}

  getQuery(): SearchRequestBody {
    const filter = buildActiveSourceFilter(this.activeSources);

    return {
      size: this.size,
      query: {
        bool: {
          must: [
            {
              neural: {
                song_vector: {
                  query_text: this.text,
                  model_id: this.modelId,
                  k: this.size,
                },
              },
            },
          ],
          ...(filter.length > 0 ? { filter } : {}),
        },
      },
    };
  }
}
