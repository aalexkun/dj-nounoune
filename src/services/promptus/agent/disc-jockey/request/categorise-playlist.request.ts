import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { CategorisePlaylistResponse } from '../response/categorise-playlist.response';
import { ToolDeclaration } from '../../../tools/tool.type';
import { categorisePlaylistPrompt } from './categorise-playlist.prompt';

export class CategorisePlaylistRequest extends PromptusRequest<CategorisePlaylistResponse> {
  public tools: ToolDeclaration[] = [];
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      description: 'An object indicating the response type and playlist parameters.',
      properties: {
        type: {
          type: 'STRING',
          enum: ['complete', 'partial', 'vibe'],
          description: 'The classification type of the user query.',
        },
        genres: {
          type: 'ARRAY',
          description: 'A list of genres identified for the playlist.',
          items: {
            type: 'STRING',
          },
        },
        artists: {
          type: 'ARRAY',
          description: 'A list of artists identified for the playlist.',
          items: {
            type: 'STRING',
          },
        },
        bpmMin: {
          type: 'NUMBER',
          description: 'The minimum BPM for the playlist.',
        },
        bpmMax: {
          type: 'NUMBER',
          description: 'The maximum BPM for the playlist.',
        },
      },
      required: ['type'],
    },
  };
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = categorisePlaylistPrompt;
  private readonly _query: string;

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
