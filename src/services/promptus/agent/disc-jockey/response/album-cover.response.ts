import { GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { PromptusResponse } from '../../../promptus.response';

const schema = z.object({
  url: z.string().default('').describe('image url'),
});

export class AlbumCoverResponse extends PromptusResponse {
  /** The resolved artwork URL, or null when the model found nothing usable. */
  public readonly imageUrl: string | null;

  constructor(raw: GenerateContentResponse) {
    super(raw);
    this.imageUrl = AlbumCoverResponse.extractUrl(this.text);
  }

  /**
   * Never throws: this lookup is a best-effort fallback running beside the commentary call, so an
   * unparsable answer has to mean "no cover" rather than failing the whole enrichment.
   */
  private static extractUrl(text: string | undefined): string | null {
    if (!text) return null;

    const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();

    try {
      const url = schema.parse(JSON.parse(cleanJson)).url.trim();

      if (!url || url.toUpperCase() === 'NONE') return null;

      return /^https?:\/\//i.test(url) ? url : null;
    } catch {
      return null;
    }
  }
}
