import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';

export interface SearchParams {
  collection: 'songs' | 'albums' | 'artists';
  function: string;
  params: any[];
}

export class CreatePlaylistResponse extends PromptusResponse {
  public parsed: SearchParams;

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        this.parsed = JSON.parse(cleanJson);
        this.validate();
      } catch (e: any) {
        throw new Error(`Failed to parse GenAI response: ${e.message}. Raw: ${raw}`);
      }
    }
  }

  private validate() {
    if (!['songs', 'albums', 'artists'].includes(this.parsed.collection)) {
      throw new Error(`Invalid collection: ${this.parsed.collection}`);
    }
    if (!this.parsed.function || !this.parsed.params) {
      throw new Error('Missing function or params in response');
    }
  }
}
