import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const schema = z.object({
  same: z.boolean(),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().default(''),
});

export class DuplicateVerdictResponse extends PromptusResponse {
  /** Defaults to "different": the safe answer when the model returned nothing usable. */
  readonly same: boolean = false;
  readonly confidence: number = 0;
  readonly reason: string = '';

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = schema.parse(JSON.parse(cleanJson));
        this.same = parsed.same;
        this.confidence = parsed.confidence;
        this.reason = parsed.reason.trim();
      } catch (e: unknown) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${cleanJson}`);
      }
    }
  }
}
