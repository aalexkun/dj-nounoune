import { z } from 'zod';

// ML Commons Task status response schema
export const MlTaskSchema = z.object({
  task_type: z.string(),
  function_name: z.string().optional(),
  state: z.enum(['CREATED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'COMPLETED_WITH_ERROR', 'CANCELLING', 'EXPIRED', 'UNREACHABLE']),
  worker_node: z.array(z.string()).optional(),
  create_time: z.number().optional(),
  last_update_time: z.number().optional(),
  is_async: z.boolean().optional(),
  model_id: z.string().optional(),
  error: z.string().optional(),
});

export type MlTask = z.infer<typeof MlTaskSchema>;

// ML Commons Model Group Register Response Schema
export const MlModelGroupRegisterResponseSchema = z.object({
  model_group_id: z.string(),
  status: z.string(),
});

export type MlModelGroupRegisterResponse = z.infer<typeof MlModelGroupRegisterResponseSchema>;

// ML Commons Model Group Search Response Schema
export const MlModelGroupSearchResponseSchema = z.object({
  hits: z.object({
    total: z.union([
      z.number(),
      z.object({
        value: z.number(),
        relation: z.string(),
      }),
    ]),
    hits: z.array(
      z.object({
        _id: z.string(),
        _source: z.object({
          name: z.string(),
          description: z.string().optional(),
        }),
      }),
    ),
  }),
});

export type MlModelGroupSearchResponse = z.infer<typeof MlModelGroupSearchResponseSchema>;

// ML Commons Model Search Response Schema
export const MlModelSearchResponseSchema = z.object({
  hits: z.object({
    total: z.union([
      z.number(),
      z.object({
        value: z.number(),
        relation: z.string(),
      }),
    ]),
    hits: z.array(
      z.object({
        _id: z.string(),
        _source: z.object({
          name: z.string(),
          model_format: z.string(),
          model_state: z.string().optional(),
          model_group_id: z.string().optional(),
          chunk_number: z.number().optional(),
          model_id: z.string().optional(),
        }),
      }),
    ),
  }),
});

export type MlModelSearchResponse = z.infer<typeof MlModelSearchResponseSchema>;

// ML Commons Agent Register Response Schema
export const MlAgentRegisterResponseSchema = z.object({
  agent_id: z.string(),
});

export type MlAgentRegisterResponse = z.infer<typeof MlAgentRegisterResponseSchema>;

// ML Commons Agent Search Response Schema
export const MlAgentSearchResponseSchema = z.object({
  hits: z.object({
    total: z.union([
      z.number(),
      z.object({
        value: z.number(),
        relation: z.string(),
      }),
    ]),
    hits: z.array(
      z.object({
        _id: z.string(),
        _source: z.object({
          name: z.string(),
          type: z.string().optional(),
          description: z.string().optional(),
        }),
      }),
    ),
  }),
});

export type MlAgentSearchResponse = z.infer<typeof MlAgentSearchResponseSchema>;

/**
 * The song document as it comes back out of the `songs` index.
 *
 * This is a **read** contract, and it has to match what `indexSongs` actually wrote rather than
 * the ideal document. Two groups of field, for two different reasons:
 *
 * - `title`, `artist` and `album` stay mandatory: `title` is `required` on the Mongoose schema, and
 *   the other two are written through a `|| ''` coercion, so all three are guaranteed strings on
 *   anything this app indexed. They are also the only fields any consumer reads.
 * - everything else is optional, because the indexer spreads the Mongo document and a field that
 *   was never set is simply absent. `year` is the one that bites: `Song.year` carries no `required`
 *   flag, so any song imported without a release year — every YouTube import, since an upload date
 *   is not a release year — produces a document with no `year` at all.
 *
 * Getting this wrong is expensive out of proportion to the field. `findDuplicatesSongs` parses the
 * whole response in one `safeParse`, so a single hit missing an optional field discarded *every*
 * hit and the lookup returned `null` — which importers read as "no duplicate found" and act on by
 * inserting a second copy of the song. A silent duplicate, caused by a field nobody reads.
 */
export const SongSourceSchema = z.object({
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  year: z.string().optional(),
  disk_number: z.number().optional(),
  track_number: z.number().optional(),
  // Written by the neural ingest pipeline and by the indexer respectively; never read back here.
  // Optional so a document predating either one cannot sink a search.
  song_vector: z.array(z.number()).optional(),
  song_semantic: z.string().optional(),
});

export type SongSource = z.infer<typeof SongSourceSchema>;

// OpenSearch Search Hit Schema
export const OpenSearchHitSchema = z.object({
  _index: z.string(),
  _id: z.string(),
  _score: z.number(),
  _source: SongSourceSchema,
});

export type OpenSearchHit = z.infer<typeof OpenSearchHitSchema>;

// OpenSearch Neural Search Query Response Schema
export const OpenSearchSearchResponseSchema = z.object({
  took: z.number(),
  timed_out: z.boolean(),
  _shards: z.object({
    total: z.number(),
    successful: z.number(),
    skipped: z.number().optional(),
    failed: z.number(),
  }),
  hits: z.object({
    total: z.union([
      z.number(),
      z.object({
        value: z.number(),
        relation: z.string(),
      }),
    ]),
    max_score: z.union([z.number(), z.null()]).optional(),
    hits: z.array(OpenSearchHitSchema),
  }),
});

export type OpenSearchSearchResponse = z.infer<typeof OpenSearchSearchResponseSchema>;

export const OpenSearchArtistSearchResponseSchema = z.object({
  took: z.number(),
  timed_out: z.boolean(),
  _shards: z.object({
    total: z.number(),
    successful: z.number(),
    skipped: z.number().optional(),
    failed: z.number(),
  }),
  hits: z.object({
    total: z.union([
      z.number(),
      z.object({
        value: z.number(),
        relation: z.string(),
      }),
    ]),
    max_score: z.union([z.number(), z.null()]).optional(),
    hits: z.array(z.any()),
  }),
  aggregations: z
    .object({
      artist_id: z.object({
        doc_count_error_upper_bound: z.number(),
        sum_other_doc_count: z.number(),
        buckets: z.array(
          z.object({
            key: z.string(),
            doc_count: z.number(),
          }),
        ),
      }),
    })
    .optional(),
});

export type OpenSearchArtistSearchResponse = z.infer<typeof OpenSearchArtistSearchResponseSchema>;

export const OpenSearchAlbumSearchResponseSchema = z.object({
  took: z.number(),
  timed_out: z.boolean(),
  _shards: z.object({
    total: z.number(),
    successful: z.number(),
    skipped: z.number().optional(),
    failed: z.number(),
  }),
  hits: z.object({
    total: z.union([
      z.number(),
      z.object({
        value: z.number(),
        relation: z.string(),
      }),
    ]),
    max_score: z.union([z.number(), z.null()]).optional(),
    hits: z.array(z.any()),
  }),
  aggregations: z
    .object({
      album_id: z.object({
        doc_count_error_upper_bound: z.number(),
        sum_other_doc_count: z.number(),
        buckets: z.array(
          z.object({
            key: z.string(),
            doc_count: z.number(),
          }),
        ),
      }),
    })
    .optional(),
});

export type OpenSearchAlbumSearchResponse = z.infer<typeof OpenSearchAlbumSearchResponseSchema>;
