import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';

/** Every field is a JSONPath the model could not always locate, hence nullable. */
const JsonPathSourceIdSchema = z.object({
  id: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  discNumber: z.string().nullable().default(null),
  trackNumber: z.string().nullable().default(null),
  albumName: z.string().nullable().default(null),
  artistName: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
});

export type JsonPathSourceId = z.infer<typeof JsonPathSourceIdSchema>;

export class GetJsonpathResponse extends PromptusResponse {
  public mapping: JsonPathSourceId;

  isValid(): boolean {
    return !!this.mapping.source;
    //return Object.values(this.mapping).every((value) => value !== null);
  }

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (raw?.text) {
      this.mapping = JsonPathSourceIdSchema.parse(JSON.parse(raw.text));
      console.log(JSON.stringify(this.mapping, null, 2));
    }
  }
}
