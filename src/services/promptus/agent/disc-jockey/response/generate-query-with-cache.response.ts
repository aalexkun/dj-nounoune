import { PromptusResponse } from '../../../promptus.response';
import { GenerateContentResponse } from '@google/genai';

export class GenerateQueryWithCacheResponse extends PromptusResponse {
  readonly aggregate: [Record<string, unknown>] | null;
  readonly fulltext: [string] | null;

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = JSON.parse(cleanJson);

        this.aggregate = JSON.parse(parsed.aggregate) || null;
        this.fulltext = parsed.fulltext || null;
      } catch (e: any) {
        throw new Error(`Failed to parse GenAI response: ${e.message}. Raw: ${raw}`);
      }
    }
  }
}