import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const schema = z.object({
  summary: z.string().default(''),
});

export class LightingMemoryResponse extends PromptusResponse {
  /** Empty when the model returned nothing usable; the caller then keeps the previous summary. */
  readonly summary: string = '';

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        this.summary = schema.parse(JSON.parse(cleanJson)).summary.trim();
      } catch (e: unknown) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${cleanJson}`);
      }
    }
  }
}
