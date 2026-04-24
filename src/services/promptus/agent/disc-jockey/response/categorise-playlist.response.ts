import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';

export interface PlaylistClassification {
  type: 'complete' | 'partial' | 'vibe';
  genres?: string[];
  artists?: string[];
  bpmMin?: number;
  bpmMax?: number;
}

export class CategorisePlaylistResponse extends PromptusResponse {
  playlistClassification: PlaylistClassification;

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (typeof raw.text === 'string') {
      const cleanJson = raw.text.replace(/```json\n?|\n?```/g, '').trim();

      const parsed = JSON.parse(cleanJson) as unknown;

      if (this.isPlaylistClassification(parsed)) {
        this.playlistClassification = parsed;
      }
    }
  }

  private isPlaylistClassification(args: unknown): args is PlaylistClassification {
    if (typeof args !== 'object' || args === null) {
      return false;
    }

    const obj = args as Record<string, unknown>;

    if (typeof obj.type !== 'string' || !['complete', 'partial', 'vibe'].includes(obj.type)) {
      return false;
    }

    if (obj.genres !== undefined) {
      if (!Array.isArray(obj.genres) || !obj.genres.every((g: unknown) => typeof g === 'string')) {
        return false;
      }
    }

    if (obj.artists !== undefined) {
      if (!Array.isArray(obj.artists) || !obj.artists.every((a: unknown) => typeof a === 'string')) {
        return false;
      }
    }

    if (obj.bpmMin !== undefined && typeof obj.bpmMin !== 'number') {
      return false;
    }

    if (obj.bpmMax !== undefined && typeof obj.bpmMax !== 'number') {
      return false;
    }

    return true;
  }
}
