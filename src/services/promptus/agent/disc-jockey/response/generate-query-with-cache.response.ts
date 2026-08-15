import { PromptusResponse } from '../../../promptus.response';
import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';

const schema = z.object({
  aggregate: z
    .array(
      z.object({
        description: z.string().describe('Description of the query'),
        query: z.string().describe('MongoDB Aggregation Query (JSON string of the pipeline)'),
      }),
    )
    .describe('List of MongoDB Aggregation Queries'),
  fulltext: z.array(z.string()).describe('List of fulltext search terms'),
});

type QuerySchema = z.infer<typeof schema>;

export class GenerateQueryWithCacheResponse extends PromptusResponse {
  readonly aggregate: { description: string; query: string; }[] | null;
  readonly fulltext: string[] | null;

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = schema.parse(cleanJson);

        this.aggregate = parsed.aggregate;
        this.fulltext = parsed.fulltext;
      } catch (e: any) {
        throw new Error(`Failed to parse GenAI response: ${e.message}. Raw: ${raw}`);
      }
    }
  }
}