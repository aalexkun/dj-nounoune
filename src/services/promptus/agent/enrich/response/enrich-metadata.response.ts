import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';

export interface EnrichMetadataItem {
  id: string;
  genre: string;
  language: string;
  country: string;
  emotion: string;
  pace: string;
  year?: string;
}

export class EnrichMetadataResponse extends PromptusResponse {
  results: EnrichMetadataItem[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (raw?.text) {
      this.results = JSON.parse(raw.text) as EnrichMetadataItem[];
    }
  }
}
