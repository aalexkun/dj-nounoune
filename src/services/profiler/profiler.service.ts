import { Injectable, Logger } from '@nestjs/common';
import { MusicDbService } from '../music-db/music-db.service';
import { OpensearchService } from '../opensearch/opensearch.service';
import { Client } from '@opensearch-project/opensearch';
import {
  ProfilerOptions,
  SchemaInferenceResult,
  InferredField,
  CardinalityResult,
  FieldCardinality,
  CompletenessResult,
  FieldCompleteness,
  DistributionResult,
  NumericDistribution,
} from './profiler.types';

@Injectable()
export class ProfilerService {
  private readonly logger = new Logger(ProfilerService.name);

  constructor(
    private readonly musicDbService: MusicDbService,
    private readonly opensearchService: OpensearchService,
  ) {}

  // A. Schema Inference
  async inferSchema(options: ProfilerOptions): Promise<SchemaInferenceResult> {
    const schema = this.musicDbService.getSchema(options.collection);
    const fields: InferredField[] = [];

    const extractPaths = (currentSchema: any, prefix: string = '') => {
      currentSchema.eachPath((path: string, schemaType: any) => {
        const fullPath = prefix ? `${prefix}.${path}` : path;
        let typeStr = 'unknown';

        if (schemaType.instance) {
          typeStr = schemaType.instance.toLowerCase();
        } else if (schemaType.options && schemaType.options.type) {
          if (typeof schemaType.options.type === 'function') {
            typeStr = schemaType.options.type.name.toLowerCase();
          } else if (Array.isArray(schemaType.options.type)) {
            typeStr = 'array';
          }
        }

        // Filter out ObjectIds
        if (typeStr !== 'objectid') {
          fields.push({ name: fullPath, type: typeStr });
        }

        // Recursively extract embedded sub-schemas
        if (schemaType.schema) {
          extractPaths(schemaType.schema, fullPath);
        } else if (schemaType.$embeddedSchemaType && schemaType.$embeddedSchemaType.schema) {
          // For Arrays of subdocuments
          extractPaths(schemaType.$embeddedSchemaType.schema, fullPath);
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
    } catch (err: any) {
      if (
        err.meta?.body?.error?.root_cause?.[0]?.reason?.includes('Text fields are not optimised') ||
        err.meta?.body?.error?.root_cause?.[0]?.reason?.includes('Fielddata is disabled')
      ) {
        aggField = `${field}.keyword`;
      }
    }
    return aggField;
  }

  // B. Cardinality and Facet Generation
  async getCardinality(options: ProfilerOptions, fields: string[], threshold: number = 50): Promise<CardinalityResult> {
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
        const aggs = response.body.aggregations as any;
        const uniqueCount = aggs?.field_cardinality?.value || 0;
        const buckets = aggs?.top_terms?.buckets || [];

        result.fields.push({
          field,
          uniqueCount,
          recommendedUsage: uniqueCount <= threshold ? 'dropdown' : 'free-text',
          topValues: uniqueCount <= threshold ? buckets.map((b: any) => ({ value: b.key, count: b.doc_count })) : undefined,
        });
      } catch (err) {
        this.logger.warn(`Failed to get cardinality for ${field}: ${(err as Error).message}`);
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

      const aggs: any = {};
      for (const field of fields) {
        const aggField = await this.resolveAggField(client, index, field);
        aggs[`missing_${field}`] = { missing: { field: aggField } };
      }

      const response = await client.search({
        index,
        body: { size: 0, aggs },
      });
      const resAggs = response.body.aggregations as any;

      for (const field of fields) {
        const missingCount = resAggs?.[`missing_${field}`]?.doc_count || 0;
        const fillRatePercentage = ((totalCount - missingCount) / totalCount) * 100;

        result.fields.push({
          field,
          totalCount,
          missingCount,
          fillRatePercentage,
        });
      }
    } catch (err) {
      this.logger.error(`Error calculating completeness: ${(err as Error).message}`);
    }

    return result;
  }

  // D. Distribution Percentiles for Numerical Data
  async getNumericDistribution(options: ProfilerOptions, fields: string[]): Promise<DistributionResult> {
    const client = this.opensearchService.getClient();
    if (!client) throw new Error('OpenSearch client not available');

    const index = options.index || options.collection;
    const result: DistributionResult = { index, fields: [] };

    const aggs: any = {};
    for (const field of fields) {
      aggs[`stats_${field}`] = { extended_stats: { field } };
      aggs[`percentiles_${field}`] = { percentiles: { field, percents: [1, 25, 50, 75, 99] } };
    }

    try {
      const response = await client.search({
        index,
        body: { size: 0, aggs },
      });
      const resAggs = response.body.aggregations as any;

      for (const field of fields) {
        const stats = resAggs?.[`stats_${field}`];
        const percentiles = resAggs?.[`percentiles_${field}`]?.values || {};

        result.fields.push({
          field,
          min: stats?.min ?? null,
          max: stats?.max ?? null,
          avg: stats?.avg ?? null,
          percentiles: {
            p1: percentiles['1.0'] ?? null,
            p25: percentiles['25.0'] ?? null,
            p50: percentiles['50.0'] ?? null,
            p75: percentiles['75.0'] ?? null,
            p99: percentiles['99.0'] ?? null,
          },
        });
      }
    } catch (err) {
      this.logger.error(`Error calculating numeric distribution: ${(err as Error).message}`);
    }

    return result;
  }
}
