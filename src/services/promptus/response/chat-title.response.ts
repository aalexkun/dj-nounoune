import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';

import { PromptusResponse } from '../promptus.response';
import { getErrorMessage } from '../../../utils/error.utils';

const schema = z.object({
  rename: z.boolean(),
  title: z.string().default(''),
});

/** Longer than this is not a title, and the history row would truncate it anyway. */
const MAX_TITLE = 60;

export class ChatTitleResponse extends PromptusResponse {
  /** Defaults to "leave it alone": the safe answer when the model returned nothing usable. */
  readonly rename: boolean = false;
  readonly title: string = '';

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = schema.parse(JSON.parse(cleanJson));

        // The instruction asks for none of these, and a model that supplies one anyway should not
        // get to put a quoted, full-stopped, novel-length string in the history sheet.
        this.title = parsed.title
          .trim()
          .replace(/^["'«»]+|["'«».]+$/g, '')
          .trim()
          .slice(0, MAX_TITLE);

        // A rename with nothing to rename to is not a rename. Reported as false rather than
        // applied, so the caller never has to check both fields.
        this.rename = parsed.rename && this.title.length > 0;
      } catch (e: unknown) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${cleanJson}`);
      }
    }
  }
}
