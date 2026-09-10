import { z } from 'zod';

const ZentityExplanationResolverSchema = z.object({
  attributes: z.array(z.string()),
});

const ZentityExplanationMatchSchema = z.object({
  attribute: z.string(),
  target_field: z.string(),
  target_value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  input_value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  input_matcher: z.string(),
  input_matcher_params: z.record(z.string(), z.unknown()).default({}),
});

const ZentityExplanationSchema = z.object({
  resolvers: z.record(z.string(), ZentityExplanationResolverSchema),
  matches: z.array(ZentityExplanationMatchSchema),
});

export const ZentityHitSchema = z.object({
  _id: z.string(),
  _index: z.string(),
  _hop: z.number(),
  _query: z.number(),
  _attributes: z.record(z.string(), z.array(z.string())),
  _source: z.record(z.string(), z.unknown()), // Depending on what's indexed
  _explanation: ZentityExplanationSchema.optional(),
});

export const ZentityResolutionResponseSchema = z.object({
  took: z.number(),
  hits: z.object({
    total: z.number().or(
      z.object({
        value: z.number(),
        relation: z.string(),
      }),
    ),
    hits: z.array(ZentityHitSchema),
  }),
});

export const SongIndexMappingSchema = z.object({
  title: z.string(),
  artist: z.string().optional(),
  album: z.string().optional(),
});

export type ZentityResolutionResponse = z.infer<typeof ZentityResolutionResponseSchema>;

export type ZentityHit = z.infer<typeof ZentityHitSchema>;
export type ZentityExplanation = z.infer<typeof ZentityExplanationSchema>;
export type ZentityExplanationMatch = z.infer<typeof ZentityExplanationMatchSchema>;
export type SongIndexMapping = z.infer<typeof SongIndexMappingSchema>;
