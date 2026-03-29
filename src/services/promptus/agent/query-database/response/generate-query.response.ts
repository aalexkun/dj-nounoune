import { PromptusResponse } from '../../../promptus.response';

export class GenerateQueryResponse extends PromptusResponse {
  collection: string;
  function: string;
  params: object[];

  constructor(raw) {
    super(raw);

    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = JSON.parse(cleanJson);
        this.collection = parsed?.collection || null;
        this.function = parsed?.function || null;
        // Type type TYPE_UNSPECIFIED may have serialised the json as a string. in the first object
        this.params = this.parseMixedJsonArray(parsed?.params);
      } catch (e: any) {
        throw new Error(`Failed to parse GenAI GenerateQueryResponse: ${e.message}. Raw: ${raw}`);
      }
    }
  }

  private parseMixedJsonArray(mixedArray: (string | Record<string, unknown>)[]): Record<string, unknown>[] {
    if (!Array.isArray(mixedArray)) {
      console.error('The provided input is not an array.');
      return [];
    }

    return mixedArray.map((item) => {
      if (typeof item === 'string') {
        try {
          return JSON.parse(item);
        } catch (error) {
          return item;
        }
      }
      return item;
    });
  }
}
