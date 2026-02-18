import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from './promptus.response';

export interface SourceId {
  id: string;
  sourceId: string;
}

export class GetSourceIdPromptusResponse extends PromptusResponse {
  public sources: SourceId[] = [];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (raw?.text) {
      this.sources = JSON.parse(raw.text);
    }
  }
}
