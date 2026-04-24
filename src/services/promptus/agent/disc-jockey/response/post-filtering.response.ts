import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';

export class PostFilteringResponse extends PromptusResponse {
  public description: string;
  public items: string[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = JSON.parse(cleanJson);
        this.description = parsed.description || '';
        this.items = parsed.items || [];
      } catch (e: any) {
        throw new Error(`Failed to parse GenAI response: ${e.message}. Raw: ${raw}`);
      }
    }
  }
}
