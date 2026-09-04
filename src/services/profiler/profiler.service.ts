import { Injectable, Logger } from '@nestjs/common';
import { MusicDbService } from '../music-db/music-db.service';
import { OpensearchService } from '../opensearch/opensearch.service';
import { Client } from '@opensearch-project/opensearch';
import {
  ProfilerOptions,
  SchemaInferenceResult,
  InferredField,
  CardinalityResult,
  CompletenessResult,
  DistributionResult,
} from './profiler.types';
import { SONGS_EMOTIONS_DESCRIPTION, SONGS_GENRE_DESCRIPTION, SONGS_PACE_DESCRIPTION } from '../../lexic/songs.description';
import { getActiveSourceTypes } from '../../config/active-source.util';

/** The one profiled field that `ACTIVE_SOURCE_TYPES` gates. */
const SOURCE_NAME_FIELD = 'source.name';

@Injectable()
export class ProfilerService {
  private readonly logger = new Logger(ProfilerService.name);

  constructor(
    private readonly musicDbService: MusicDbService,
    private readonly opensearchService: OpensearchService,
  ) {}

  // todo replace for dynamic fields
  private getFieldsToAnalyze(collection: 'songs' | 'artists' | 'albums'): string[] {

    if(collection === 'songs'){
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

    if(collection === 'artists'){
      return [
        'artist'
      ]
    } if(collection === 'albums'){
      return [
        'title'
      ];
    }

    return []

  }

  async getDatabaseProfileForPrompt(): Promise<string> {
    let output = '';
    const appendLine = (str: string) => (output += str + '\n');
    const appendJson = (obj: any) => (output += '```JSON\n' + JSON.stringify(obj, null, 2) + '\n```\n\n');
    const collections: Array<'songs' | 'artists' | 'albums'> = ['songs', 'artists', 'albums']; //

    for (const collection of collections) {
      appendLine(`# Analysis for ${collection} collection.\n`);

      appendLine(`## ${collection} Schema`);
      const schema = await this.inferSchema({ collection });
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
  async inferSchema(options: ProfilerOptions): Promise<SchemaInferenceResult> {
    const schema = this.musicDbService.getSchema(options.collection);
    const fields: InferredField[] = [];

    const extractPaths = (currentSchema: any, prefix: string = '') => {
      currentSchema.eachPath((path: string, schemaType: any) => {
        const fullPath = prefix ? `${prefix}.${path}` : path;
        let typeStr = 'unknown';

        if (schemaType.instance && schemaType.instance.toLowerCase() !== 'mixed') {
          typeStr = schemaType.instance.toLowerCase();
        } else if (schemaType.options && schemaType.options.type) {
          if (typeof schemaType.options.type === 'function') {
            typeStr = schemaType.options.type.name.toLowerCase();
          } else if (Array.isArray(schemaType.options.type)) {
            typeStr = 'array';
          } else if (schemaType.options.type instanceof Object) {
            typeStr = 'mongoose.Schema.Types.ObjectId';
          }
        }

        // `@Prop({ description })` survives as a plain schema-type option. Passing it through is
        // what lets the query generator read a field's purpose off the profile instead of needing
        // a hand-written rule per field in its prompt.
        const description = typeof schemaType.options?.description === 'string' ? schemaType.options.description : undefined;

        if (typeStr === 'mongoose.Schema.Types.ObjectId') {
          fields.push({ name: fullPath, type: 'mongoose.Schema.Types.ObjectId', ref: schemaType.options.ref, description });
        } else {
          fields.push({ name: fullPath, type: typeStr, description });
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
        const aggs = response.body.aggregations as any;
        let uniqueCount = aggs?.field_cardinality?.value || 0;
        let buckets = aggs?.top_terms?.buckets || [];

        // This document grounds the LLM. Advertising a source whose subscription is inactive would
        // invite the model to generate filters for songs it can never play.
        if (field === SOURCE_NAME_FIELD) {
          const activeSources = getActiveSourceTypes();
          if (activeSources) {
            const kept = buckets.filter((b: any) => (activeSources as readonly string[]).includes(String(b.key)));
            uniqueCount = Math.min(uniqueCount, kept.length);
            buckets = kept;
          }
        }

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

      const activeSources = getActiveSourceTypes();
      const aggs: any = {};
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
