import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const PipelineStageSchema = z.record(z.string(), z.unknown());

/** A stage may arrive JSON-encoded as a string: TYPE_UNSPECIFIED in the response schema does that. */
const GenerateQueryPayloadSchema = z.object({
  collection: z.string().nullish(),
  function: z.string().nullish(),
  params: z.array(z.union([z.string(), PipelineStageSchema])).nullish(),
});

export class GenerateQueryResponse extends PromptusResponse {
  collection: string | null;
  function: string | null;
  params: Record<string, unknown>[];

  constructor(raw: GenerateContentResponse) {
    super(raw);

    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = GenerateQueryPayloadSchema.parse(JSON.parse(cleanJson));
        this.collection = parsed.collection || null;
        this.function = parsed.function || null;
        this.params = this.parseMixedJsonArray(parsed.params ?? []);

        console.log(JSON.stringify(this.params, null, 2));
      } catch (e) {
        throw new Error(`Failed to parse GenAI GenerateQueryResponse: ${getErrorMessage(e)}. Raw: ${raw.text}`);
      }
    }
  }

  /** Decodes string-encoded stages; one that is not valid JSON for an object is dropped with a note. */
  private parseMixedJsonArray(mixedArray: (string | Record<string, unknown>)[]): Record<string, unknown>[] {
    return mixedArray.flatMap((item) => {
      if (typeof item !== 'string') {
        return [item];
      }
      try {
        const decoded = PipelineStageSchema.safeParse(JSON.parse(item));
        if (decoded.success) return [decoded.data];
      } catch {
        // fall through: not JSON
      }
      console.error(`Dropping pipeline stage that is not a JSON object: ${item}`);
      return [];
    });
  }
}
