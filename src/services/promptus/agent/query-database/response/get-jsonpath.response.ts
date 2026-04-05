import { GenerateContentResponse } from '@google/genai';
import { PromptusResponse } from '../../../promptus.response';

export interface JsonPathSourceId {
  id: string;
  sourceId: string;
  discNumber: string;
  trackNumber: string;
  albumName: string;
  artistName: string;
  title: string;
}

export class GetJsonpathResponse extends PromptusResponse {
  public mapping: JsonPathSourceId;

  isValid(): boolean {
    return !!this.mapping.sourceId;
    //return Object.values(this.mapping).every((value) => value !== null);
  }

  constructor(raw: GenerateContentResponse) {
    super(raw);
    if (raw?.text) {
      const mapping = JSON.parse(raw.text);

      console.log(JSON.stringify(mapping, null, 2));

      this.mapping = {
        id: mapping.id ?? null,
        sourceId: mapping.sourceId ?? null,
        discNumber: mapping.discNumber ?? null,
        trackNumber: mapping.trackNumber ?? null,
        albumName: mapping.albumName ?? null,
        artistName: mapping.artistName ?? null,
        title: mapping.title ?? null,
      };
    }
  }
}
