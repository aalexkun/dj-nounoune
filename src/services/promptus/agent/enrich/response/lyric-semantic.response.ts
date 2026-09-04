import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const schema = z.object({
  semantic: z.string().default('').describe('One-sentence distillation of what the song is about'),
});

export class LyricSemanticResponse extends PromptusResponse {
  /** Trimmed; empty rather than undefined when the model returned nothing usable. */
  readonly semantic: string = '';

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        this.semantic = schema.parse(JSON.parse(cleanJson)).semantic.trim();
      } catch (e: unknown) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${cleanJson}`);
      }
    }
  }
}
