import { GenerateContentResponse } from '@google/genai';

export abstract class PromptusResponse {
  protected constructor(public readonly raw: GenerateContentResponse) {}
}
