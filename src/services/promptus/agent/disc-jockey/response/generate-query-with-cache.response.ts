import { PromptusResponse } from '../../../promptus.response';
import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { MongoQueryDefinition, MongoQueryDefinitionSchema } from '../../../../music-db/mongo-filter.type';
import { getErrorMessage } from '../../../../../utils/error.utils';

const schema = z.object({
  aggregate: z.array(MongoQueryDefinitionSchema).default([]).describe('Structured database queries to compile into $match'),
  fulltext: z.array(z.string()).default([]).describe('List of fulltext search terms'),
  semantic: z.string().default('').describe('Normalised sentence for the lyric semantic search, or empty'),
});

export class GenerateQueryWithCacheResponse extends PromptusResponse {
  /** Empty rather than null when the model returned nothing usable, so callers can iterate unconditionally. */
  readonly aggregate: MongoQueryDefinition[] = [];
  readonly fulltext: string[] = [];
  /** Trimmed; empty when the request was about identity or a formal dimension rather than subject matter. */
  readonly semantic: string = '';

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = schema.parse(JSON.parse(cleanJson));

        this.aggregate = parsed.aggregate;
        this.fulltext = parsed.fulltext;
        this.semantic = parsed.semantic.trim();
      } catch (e: unknown) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${cleanJson}`);
      }
    }
  }
}
