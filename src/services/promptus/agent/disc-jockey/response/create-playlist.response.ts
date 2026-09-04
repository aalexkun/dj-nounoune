import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';
import { isMusicSearchResult, MusicSearchResult } from '../disc-jockey.agent';
import { getErrorMessage } from '../../../../../utils/error.utils';

const CreatePlaylistPayloadSchema = z.object({
  description: z.string().optional(),
  items: z.array(z.unknown()).optional(),
});

export class CreatePlaylistResponse extends PromptusResponse {
  public description: string;
  public items: MusicSearchResult[];

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();
      try {
        const parsed = CreatePlaylistPayloadSchema.parse(JSON.parse(cleanJson));

        this.description = parsed.description || 'The tool did not return anything';
        this.items = (parsed.items ?? []).filter(isMusicSearchResult);
      } catch (e) {
        throw new Error(`Failed to parse GenAI response: ${getErrorMessage(e)}. Raw: ${raw.text}`);
      }
    }
  }
}
