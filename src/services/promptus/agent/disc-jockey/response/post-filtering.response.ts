import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const schema = z.object({
  items: z.array(z.string()).default([]).describe('Song IDs that passed the filter'),
});

export class PostFilteringResponse extends PromptusResponse {
  /** Empty rather than null when the model returned nothing usable, so callers can iterate unconditionally. */
  readonly items: string[] = [];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = schema.parse(JSON.parse(cleanJson));

        this.items = parsed.items;
      } catch (e: unknown) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${cleanJson}`);
      }
    }
  }
}
