import { GenerateContentConfig } from '@google/genai';
import { CacheRequest, PromptusRequest, RequestRole, StructuredResponse } from './PromptusRequest';
import { GetSourceIdPromptusResponse } from '../response/GetSourceIdPromptusResponse';

export class GetSourceIdPromptusRequest extends PromptusRequest<GetSourceIdPromptusResponse> {
  public config: Partial<GenerateContentConfig>;
  public cache?: CacheRequest;
  private readonly _model = 'gemini-flash-lite-latest';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/GetSourceIdPromptusRequest.md';
  private readonly _query: string;

  public structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'ARRAY',
      description: 'A list of extracted song identifiers and their source paths.',
      items: {
        type: 'OBJECT',
        properties: {
          sourceId: {
            type: 'STRING',
            description: 'The identifier or file path found within the source object (e.g., from source[0].sourceId).',
          },
          id: {
            type: 'STRING',
            description: 'The unique identifier for the item (mapped from _id).',
          },
          trackNumber: {
            type: 'NUMBER',
            description: 'The track number (mapped from track_number).',
          },
          diskNumber: {
            type: 'NUMBER',
            description: 'The disk number for the item (mapped from disk_number).',
          },
        },
        required: ['sourceId', 'id'],
      },
    },
  };

  get model(): string {
    return this._model;
  }

  get role(): RequestRole {
    return this._role;
  }

  get context(): string {
    return this._context;
  }
  get query(): string {
    return this._query;
  }

  constructor(query: string) {
    super();
    this._query = query;
  }
}
