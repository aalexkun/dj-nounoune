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

// Song Source document fields in OpenSearch
export const SongSourceSchema = z.object({
  year: z.string(),
  disk_number: z.number().optional(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  song_vector: z.array(z.number()),
  song_semantic: z.string(),
  track_number: z.number().optional(),
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