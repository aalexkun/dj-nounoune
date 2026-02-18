import { GenerateContentResponse } from '@google/genai';

export interface SourceId {
  id: string;
  sourceId: string;
}

export class GetSourceIdPromptusResponse {
  public sources: SourceId[] = [];

  constructor(raw: GenerateContentResponse) {
    if (raw?.text) {
      this.sources = JSON.parse(raw.text);
    }
  }
}
