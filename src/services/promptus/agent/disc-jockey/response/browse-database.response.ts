import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';

export interface BrowseItem {
  id: string;
  title?: string;
  artist: string;
  album?: string;
}

export class BrowseDatabaseResponse extends PromptusResponse {
  public description: string;
  public items: BrowseItem[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = JSON.parse(cleanJson);

        this.description = parsed.description || 'No description provided';
        if (Array.isArray(parsed.items)) {
          this.items = parsed.items;
        } else {
          this.items = [];
        }
      } catch (e: any) {
        throw new Error(`Failed to parse GenAI response: ${e.message}. Raw: ${raw.text}`);
      }
    } else {
      this.description = 'No response from AI';
      this.items = [];
    }
  }
}
