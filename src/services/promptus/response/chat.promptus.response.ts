import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../promptus.response';

export class ChatPromptusResponse extends PromptusResponse {
  constructor(raw: GenerateContentResponse) {
    super(raw);
  }
}
