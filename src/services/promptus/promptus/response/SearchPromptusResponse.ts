import { GenerateContentResponse } from '@google/genai';

export interface SearchParams {
  collection: 'songs' | 'albums' | 'artists';
  function: string;
  params: any[];
}

export class SearchPromptusResponse {
  public parsed: SearchParams;

  constructor(raw: GenerateContentResponse) {
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
