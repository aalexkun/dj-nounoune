import { PromptusResponse } from './promptus.response';
import { GenerateContentResponse } from '@google/genai';

export class ChatPromptusResponse extends PromptusResponse {
  constructor(raw: GenerateContentResponse) {
    super(raw);
  }
}
