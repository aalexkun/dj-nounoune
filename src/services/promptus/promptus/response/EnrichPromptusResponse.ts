import { GenerateContentResponse } from '@google/genai';

export class EnrichPromptusResponse {
  psv: string;

  constructor(raw: GenerateContentResponse) {
    const text = raw?.text || '';
    const matchCsv = text.match(/```csv\s*([\s\S]*?)\s*```/);
    const matchPsv = text.match(/```psv\s*([\s\S]*?)\s*```/);

    if (matchPsv) {
      this.psv = matchPsv[1].trim() || '';
    } else if (matchCsv) {
      this.psv = matchCsv[1].trim() || '';
    } else {
      this.psv = text;
    }
  }
}
