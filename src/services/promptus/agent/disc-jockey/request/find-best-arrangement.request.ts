import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { FindBestArrangementResponse } from '../response/find-best-arrangement.response';
import { ToolDeclaration } from '../../../tools/tool.type';
import { findBestArrangementPrompt } from './find-best-arrangement.prompt';

export class FindBestArrangementRequest extends PromptusRequest<FindBestArrangementResponse> {
  public tools: ToolDeclaration[] = [];
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      description: 'An object containing the best arrangement of songs.',
      properties: {
        description: {
          type: 'STRING',
          description: 'A description of why this arrangement was chosen.',
        },
        items: {
          type: 'ARRAY',
          description: 'A list of song IDs in the recommended order.',
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
  private readonly _context = findBestArrangementPrompt;
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
