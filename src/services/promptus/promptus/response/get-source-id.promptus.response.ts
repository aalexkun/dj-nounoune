import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from './promptus.response';

export interface JsonPathSourceId {
  id: string | null;
  sourceId: string | null;
  discNumber: string | null;
  trackNumber: string | null;
}

export class GetSourceIdPromptusResponse extends PromptusResponse {
  public mapping: JsonPathSourceId = {
    id: null,
    sourceId: null,
    discNumber: null,
    trackNumber: null,
  };

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (raw?.text) {
      const mapping = JSON.parse(raw.text);

      this.mapping.id = mapping.id ?? null;
      this.mapping.sourceId = mapping.sourceId ?? null;
      this.mapping.discNumber = mapping.discNumber ?? null;
      this.mapping.trackNumber = mapping.trackNumber ?? null;
    }
  }
}
