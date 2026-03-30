import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';
import { isMusicSearchResult, MusicSearchResult } from '../disc-jockey.agent';

export class CreatePlaylistResponse extends PromptusResponse {
  public description: string;
  public items: MusicSearchResult[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = JSON.parse(cleanJson);

        this.description = parsed.description || 'The tool did not return anything';
        if (Array.isArray(parsed.items)) {
          this.items = parsed.items.filter((s) => isMusicSearchResult(s));
        } else {
          this.items = [];
        }
      } catch (e: any) {
        throw new Error(`Failed to parse GenAI response: ${e.message}. Raw: ${raw}`);
      }
    }
  }
}
