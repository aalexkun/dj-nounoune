import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';

/** Prose: the designer's two or three sentences to the user. Callers read `text`. */
export class DesignLightingResponse extends PromptusResponse {
  constructor(raw: GenerateContentResponse) {
    super(raw);
  }
}
