import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { getErrorMessage } from '../../../../../utils/error.utils';

const BrowseItemSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  artist: z.string(),
  album: z.string().optional(),
});

export type BrowseItem = z.infer<typeof BrowseItemSchema>;

/** Items are validated one by one so a single malformed row drops rather than voiding the answer. */
const BrowseDatabasePayloadSchema = z.object({
  description: z.string().optional(),
  items: z.array(z.unknown()).optional(),
});

export class BrowseDatabaseResponse extends PromptusResponse {
  public description: string;
  public items: BrowseItem[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = BrowseDatabasePayloadSchema.parse(JSON.parse(cleanJson));

        this.description = parsed.description || 'No description provided';
        this.items = (parsed.items ?? []).flatMap((item) => {
          const result = BrowseItemSchema.safeParse(item);
          return result.success ? [result.data] : [];
        });
      } catch (e) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${raw.text}`);
      }
    } else {
      this.description = 'No response from AI';
      this.items = [];
    }
  }
}
