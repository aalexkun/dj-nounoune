import { PromptusResponse } from '../../../promptus.response';
import { GenerateContentResponse } from '@google/genai';

/** Free-form markdown answer about music the library does not hold. */
export class MusicTalkResponse extends PromptusResponse {
  constructor(raw: GenerateContentResponse) {
    super(raw);
  }
}
