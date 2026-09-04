import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const FindBestArrangementPayloadSchema = z.object({
  description: z.string().optional(),
  items: z.array(z.string()).optional(),
});

export class FindBestArrangementResponse extends PromptusResponse {
  public description: string;
  public items: string[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = FindBestArrangementPayloadSchema.parse(JSON.parse(cleanJson));
        this.description = parsed.description || '';
        this.items = parsed.items ?? [];
      } catch (e) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${raw.text}`);
      }
    }
  }
}
