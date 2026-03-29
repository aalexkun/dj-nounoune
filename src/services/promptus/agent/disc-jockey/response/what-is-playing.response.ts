import { PromptusResponse } from '../../../promptus.response';
import { GenerateContentResponse } from '@google/genai';

export class WhatIsPlayingResponse extends PromptusResponse {
  constructor(raw: GenerateContentResponse) {
    super(raw);
  }
}
