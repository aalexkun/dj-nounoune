import { PromptusResponse } from '../../../promptus.response';
import { GenerateContentResponse } from '@google/genai';

/** Markdown listing of the upcoming dates. Unstructured: a grounded request cannot ask for a schema. */
export class ArtistPerformanceResponse extends PromptusResponse {
  constructor(raw: GenerateContentResponse) {
    super(raw);
  }
}
