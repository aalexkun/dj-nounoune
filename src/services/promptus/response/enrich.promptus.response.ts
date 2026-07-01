import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../promptus.response';

export interface EnrichResponse {
  id: string;
  genre: string;
  language: string;
  country: string;
  emotion: string;
  pace: string;
  year?: string;
}

export class EnrichPromptusResponse extends PromptusResponse {
  results: EnrichResponse[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (raw?.text) {
      this.results = JSON.parse(raw.text) as EnrichResponse[];
    }
  }
}
