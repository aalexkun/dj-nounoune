import { GenerateContentResponse } from '@google/genai';
import { PsvService } from '../../../transformation/psv.service';

export class EnrichPromptusResponse {
  private psv: string;

  constructor(raw: GenerateContentResponse) {
    const text = raw?.text || '';
    const match = text.match(/```csv\s*([\s\S]*?)\s*```/);

    this.psv = match ? match[1].trim() : '';
  }

  public getParsedData() {}
}
