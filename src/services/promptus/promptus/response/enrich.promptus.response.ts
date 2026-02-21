import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from './promptus.response';

export interface EnrichResponse {
  id: string;
  genre: string;
}

export class EnrichPromptusResponse extends PromptusResponse {
  genre: EnrichResponse[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (raw?.text) {
      this.genre = JSON.parse(raw.text) as EnrichResponse[];
    }
  }
}
