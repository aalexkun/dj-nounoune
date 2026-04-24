import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { PostFilteringResponse } from '../response/post-filtering.response';
import { ToolDeclaration } from '../../../tools/tool.type';
import { postFilteringPrompt } from './post-filtering.prompt';

export class PostFilteringRequest extends PromptusRequest<PostFilteringResponse> {
  public tools: ToolDeclaration[] = [];
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      description: 'An object containing the filtered list of songs.',
      properties: {
        description: {
          type: 'STRING',
          description: 'A description of the filtering process.',
        },
        items: {
          type: 'ARRAY',
          description: 'A list of song IDs that passed the filter.',
          items: {
            type: 'STRING',
          },
        },
      },
      required: ['description', 'items'],
    },
  };
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = postFilteringPrompt;
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
