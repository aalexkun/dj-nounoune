import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { GetSourceIdPromptusResponse } from '../response/get-source-id.promptus.response';
import { ToolDeclaration } from '../tools/tool.type';

export class GetSourceIdPromptusRequest extends PromptusRequest<GetSourceIdPromptusResponse> {
  public tools: ToolDeclaration[] = [];
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/get-source-id.promptus.request.md';
  private readonly _query: string;

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
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
        artist: {
          type: 'STRING',
          description: 'The artist name (mapped from artist name).',
        },
        title: {
          type: 'STRING',
          description: 'The title of the item (mapped from title).',
        },
        album: {
          type: 'STRING',
          description: 'The album of the item (mapped from album name).',
        },
      },
      required: ['sourceId', 'id'],
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
