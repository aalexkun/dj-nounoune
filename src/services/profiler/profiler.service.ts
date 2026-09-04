import { Injectable, Logger } from '@nestjs/common';
import { Schema, SchemaType } from 'mongoose';
import { z } from 'zod';
import { MusicDbService } from '../music-db/music-db.service';
import { OpensearchService } from '../opensearch/opensearch.service';
import { Client } from '@opensearch-project/opensearch';
import type { AggregationContainer } from '@opensearch-project/opensearch/api/_types/_common.aggregations.js';
import { ProfilerOptions, SchemaInferenceResult, InferredField, CardinalityResult, CompletenessResult, DistributionResult } from './profiler.types';
import { SONGS_EMOTIONS_DESCRIPTION, SONGS_GENRE_DESCRIPTION, SONGS_PACE_DESCRIPTION } from '../../lexic/songs.description';
import { getActiveSourceTypes } from '../../config/active-source.util';
import { getErrorMessage } from '../../utils/error.utils';

/** The one profiled field that `ACTIVE_SOURCE_TYPES` gates. */
const SOURCE_NAME_FIELD = 'source.name';

/** What the schema walk needs; mongoose's own `Schema` type is generic over `any` on every slot. */
type PathWalker = { eachPath(fn: (path: string, schemaType: SchemaType) => void): unknown };

const isPathWalker = (value: unknown): value is PathWalker => value instanceof Schema;

/*
 * The aggregation shapes this profiler reads back. The client types `aggregations` as a union of
 * every aggregate OpenSearch can return, so each response is narrowed here to the few keys asked
 * for, with a failed parse reading as "no data" rather than a crash.
 */
const TermsBucketSchema = z.object({
  key: z.union([z.string(), z.number()]),
  doc_count: z.number(),
});

const CardinalityAggregationsSchema = z.object({
  field_cardinality: z.object({ value: z.number() }).optional(),
  top_terms: z.object({ buckets: z.array(TermsBucketSchema) }).optional(),
});

const DocCountAggregateSchema = z.object({ doc_count: z.number() });

const StatsAggregateSchema = z.object({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  avg: z.number().nullable().optional(),
});

const PercentilesAggregateSchema = z.object({
  values: z.record(z.string(), z.number().nullable()),
});

/** The part of an OpenSearch error `resolveAggField` reads: the first root cause's reason. */
const OpenSearchErrorSchema = z.object({
  meta: z.object({
    body: z.object({
      error: z.object({
        root_cause: z.array(z.object({ reason: z.string().optional() })),
      }),
    }),
  }),
});

@Injectable()
export class ProfilerService {
  private readonly logger = new Logger(ProfilerService.name);

  constructor(
    private readonly musicDbService: MusicDbService,
    private readonly opensearchService: OpensearchService,
  ) {}

  // todo replace for dynamic fields
  private getFieldsToAnalyze(collection: 'songs' | 'artists' | 'albums'): string[] {
    if (collection === 'songs') {
      return [
        'genre',
        'emotion',
        'language',
        'pace',
        'year',
        'artist',
        'album',
        'source.name',
        'source.technical_info.is_high_res',
        'source.technical_info.is_cd_quality',
      ];
    }

    if (collection === 'artists') {
      return ['artist'];
    }
    if (collection === 'albums') {
      return ['title'];
    }

    return [];
  }

  async getDatabaseProfileForPrompt(): Promise<string> {
    let output = '';
    const appendLine = (str: string) => (output += str + '\n');
    const appendJson = (obj: unknown) => (output += '```JSON\n' + JSON.stringify(obj, null, 2) + '\n```\n\n');
    const collections: Array<'songs' | 'artists' | 'albums'> = ['songs', 'artists', 'albums']; //

    for (const collection of collections) {
      appendLine(`# Analysis for ${collection} collection.\n`);

      appendLine(`## ${collection} Schema`);
      const schema = this.inferSchema({ collection });
      appendJson(schema);

      if (collection === 'songs') {
        const fieldsToAnalyze = this.getFieldsToAnalyze(collection);

        appendLine(`## ${collection} Schema  Cardinality and Facet Generation`);
        const cardinality = await this.getCardinality({ collection }, fieldsToAnalyze);
        appendJson(cardinality);

        appendLine(`## ${collection} Schema Completeness and Null Tracking`);
        const completeness = await this.getCompleteness({ collection }, fieldsToAnalyze);
        appendJson(completeness);
      }
    }

    appendLine(`# Song Lexic\n`);
    appendLine(`## Genre List`);
    appendLine(`${SONGS_GENRE_DESCRIPTION}`);

    appendLine(`## Pace List`);
    appendLine(`${SONGS_PACE_DESCRIPTION}`);

    appendLine(`## Emotion List`);
    appendLine(`${SONGS_EMOTIONS_DESCRIPTION}`);

    return output;
  }

  // A. Schema Inference
  inferSchema(options: ProfilerOptions): SchemaInferenceResult {
    const schema = this.musicDbService.getSchema(options.collection);
    const fields: InferredField[] = [];

    const extractPaths = (currentSchema: PathWalker, prefix: string = '') => {
      currentSchema.eachPath((path: string, schemaType: SchemaType) => {
        const fullPath = prefix ? `${prefix}.${path}` : path;
        // `options` is mongoose's loose bag of schema-type options; read it as unknown values.
        const options: Record<string, unknown> = schemaType.options;
        let typeStr = 'unknown';

        if (schemaType.instance && schemaType.instance.toLowerCase() !== 'mixed') {
          typeStr = schemaType.instance.toLowerCase();
        } else if (options.type) {
          if (typeof options.type === 'function') {
            typeStr = options.type.name.toLowerCase();
          } else if (Array.isArray(options.type)) {
            typeStr = 'array';
          } else if (options.type instanceof Object) {
            typeStr = 'mongoose.Schema.Types.ObjectId';
          }
        }

        // `@Prop({ description })` survives as a plain schema-type option. Passing it through is
        // what lets the query generator read a field's purpose off the profile instead of needing
        // a hand-written rule per field in its prompt.
        const description = typeof options.description === 'string' ? options.description : undefined;

        if (typeStr === 'mongoose.Schema.Types.ObjectId') {
          const ref = typeof options.ref === 'string' ? options.ref : undefined;
          fields.push({ name: fullPath, type: 'mongoose.Schema.Types.ObjectId', ref, description });
        } else {
          fields.push({ name: fullPath, type: typeStr, description });
        }

        // Recursively extract embedded sub-schemas: a subdocument carries its schema directly, an
        // array of subdocuments carries it on the embedded schema type.
        const nested: unknown =
          (schemaType as { schema?: unknown }).schema ?? (schemaType as { $embeddedSchemaType?: { schema?: unknown } }).$embeddedSchemaType?.schema;
        if (isPathWalker(nested)) {
          extractPaths(nested, fullPath);
        }
      });
    };

    extractPaths(schema);

    return {
      collection: options.collection,
      sampleSize: 0,
      fields,
    };
  }

  private async resolveAggField(client: Client, index: string, field: string): Promise<string> {
    let aggField = field;
    try {
      await client.search({
        index,
        body: { size: 0, aggs: { test: { terms: { field: aggField } } } },
      });
    } catch (err) {
      const parsed = OpenSearchErrorSchema.safeParse(err);
      const reason = parsed.success ? (parsed.data.meta.body.error.root_cause[0]?.reason ?? '') : '';
      if (reason.includes('Text fields are not optimised') || reason.includes('Fielddata is disabled')) {
        aggField = `${field}.keyword`;
      }
    }
    return aggField;
  }

  // B. Cardinality and Facet Generation
  async getCardinality(options: ProfilerOptions, fields: string[], threshold: number = 100): Promise<CardinalityResult> {
    const client = this.opensearchService.getClient();
    if (!client) throw new Error('OpenSearch client not available');

    const index = options.index || options.collection;
    const result: CardinalityResult = { index, fields: [] };

    for (const field of fields) {
      const aggField = await this.resolveAggField(client, index, field);

      const query = {
        size: 0,
        aggs: {
          field_cardinality: { cardinality: { field: aggField } },
          top_terms: { terms: { field: aggField, size: threshold } },
        },
      };

      try {
        const response = await client.search({ index, body: query });
        const parsed = CardinalityAggregationsSchema.safeParse(response.body.aggregations);
        const aggs = parsed.success ? parsed.data : {};
        let uniqueCount = aggs.field_cardinality?.value ?? 0;
        let buckets = aggs.top_terms?.buckets ?? [];

        // This document grounds the LLM. Advertising a source whose subscription is inactive would
        // invite the model to generate filters for songs it can never play.
        if (field === SOURCE_NAME_FIELD) {
          const activeSources = getActiveSourceTypes();
          if (activeSources) {
            const kept = buckets.filter((b) => (activeSources as readonly string[]).includes(String(b.key)));
            uniqueCount = Math.min(uniqueCount, kept.length);
            buckets = kept;
          }
        }

        result.fields.push({
          field,
          uniqueCount,
          recommendedUsage: uniqueCount <= threshold ? 'dropdown' : 'free-text',
          topValues: uniqueCount <= threshold ? buckets.map((b) => ({ value: b.key, count: b.doc_count })) : undefined,
        });
      } catch (err) {
        this.logger.warn(`Failed to get cardinality for ${field}: ${getErrorMessage(err)}`);
      }
    }
    return result;
  }

  // C. Completeness and Null Tracking
  async getCompleteness(options: ProfilerOptions, fields: string[]): Promise<CompletenessResult> {
    const client = this.opensearchService.getClient();
    if (!client) throw new Error('OpenSearch client not available');

    const index = options.index || options.collection;
    const result: CompletenessResult = { index, fields: [] };

    try {
      const countRes = await client.count({ index });
      const totalCount = countRes.body.count;

      if (totalCount === 0) {
        return result;
      }

      const activeSources = getActiveSourceTypes();
      const aggs: Record<string, AggregationContainer> = {};
      for (const field of fields) {
        const aggField = await this.resolveAggField(client, index, field);
        if (field === SOURCE_NAME_FIELD && activeSources) {
          // Under gating, "missing" means "not reachable": a song available only on an inactive
          // source is as good as absent for the agent.
          aggs[`missing_${field}`] = { filter: { bool: { must_not: { terms: { [aggField]: activeSources } } } } };
        } else {
          aggs[`missing_${field}`] = { missing: { field: aggField } };
        }
      }

      const response = await client.search({
        index,
        body: { size: 0, aggs },
      });
      const resAggs = response.body.aggregations ?? {};

      for (const field of fields) {
        const missing = DocCountAggregateSchema.safeParse(resAggs[`missing_${field}`]);
        const missingCount = missing.success ? missing.data.doc_count : 0;
        const fillRatePercentage = ((totalCount - missingCount) / totalCount) * 100;

        result.fields.push({
          field,
          totalCount,
          missingCount,
          fillRatePercentage,
        });
      }
    } catch (err) {
      this.logger.error(`Error calculating completeness: ${getErrorMessage(err)}`);
    }

    return result;
  }

  // D. Distribution Percentiles for Numerical Data
  async getNumericDistribution(options: ProfilerOptions, fields: string[]): Promise<DistributionResult> {
    const client = this.opensearchService.getClient();
    if (!client) throw new Error('OpenSearch client not available');

    const index = options.index || options.collection;
    const result: DistributionResult = { index, fields: [] };

    const aggs: Record<string, AggregationContainer> = {};
    for (const field of fields) {
      aggs[`stats_${field}`] = { extended_stats: { field } };
      aggs[`percentiles_${field}`] = { percentiles: { field, percents: [1, 25, 50, 75, 99] } };
    }

    try {
      const response = await client.search({
        index,
        body: { size: 0, aggs },
      });
      const resAggs = response.body.aggregations ?? {};

      for (const field of fields) {
        const stats = StatsAggregateSchema.safeParse(resAggs[`stats_${field}`]);
        const percentiles = PercentilesAggregateSchema.safeParse(resAggs[`percentiles_${field}`]);
        const values = percentiles.success ? percentiles.data.values : {};

        result.fields.push({
          field,
          min: stats.success ? (stats.data.min ?? null) : null,
          max: stats.success ? (stats.data.max ?? null) : null,
          avg: stats.success ? (stats.data.avg ?? null) : null,
          percentiles: {
            p1: values['1.0'] ?? null,
            p25: values['25.0'] ?? null,
            p50: values['50.0'] ?? null,
            p75: values['75.0'] ?? null,
            p99: values['99.0'] ?? null,
          },
        });
      }
    } catch (err) {
      this.logger.error(`Error calculating numeric distribution: ${getErrorMessage(err)}`);
    }

    return result;
  }
}
