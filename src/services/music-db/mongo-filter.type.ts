import { z } from 'zod';

/**
 * Intermediate query format emitted by the LLM instead of a raw MongoDB pipeline.
 *
 * Asking a model to hand-write an aggregation pipeline as an escaped JSON string is
 * fragile (double escaping), unvalidatable, and hands arbitrary stages to the driver.
 * Instead the model emits flat, strictly-typed conditions and the backend compiles
 * them into a `$match` deterministically — see `buildMatch` in `mongo-filter.util.ts`.
 */

/** Collections a condition can target. Non-song conditions resolve to ids, then constrain songs via their refs. */
export const FILTER_COLLECTIONS = ['songs', 'artists', 'albums'] as const;

/** Comparison operators the compiler knows how to translate. Anything else is rejected by Zod. */
export const FILTER_OPERATORS = ['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$regex', '$exists', '$all'] as const;

export const FilterConditionSchema = z.object({
  collection: z.enum(FILTER_COLLECTIONS).describe('Collection the field belongs to'),
  field: z.string().describe('Dotted path within the collection, e.g. "genre" or "source.technical_info.is_high_res"'),
  operator: z.enum(FILTER_OPERATORS).describe('Comparison operator'),
  value: z.array(z.union([z.string(), z.number(), z.boolean()])).describe('Always an array; scalar operators use the first entry'),
  negate: z.boolean().optional().describe('Logical NOT of this condition'),
});

export const MongoQueryDefinitionSchema = z.object({
  description: z.string().describe('Intent of the query, echoed back on the result'),
  filters: z.array(FilterConditionSchema).describe('Conditions combined with AND'),
});

export type FilterCollection = (typeof FILTER_COLLECTIONS)[number];
export type FilterOperator = (typeof FILTER_OPERATORS)[number];
export type FilterCondition = z.infer<typeof FilterConditionSchema>;
export type MongoQueryDefinition = z.infer<typeof MongoQueryDefinitionSchema>;
