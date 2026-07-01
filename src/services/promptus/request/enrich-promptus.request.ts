import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../promptus.request';
import { EnrichPromptusResponse } from '../response/enrich.promptus.response';
import { ToolDeclaration } from '../tools/tool.type';

export class EnrichPromptusRequest extends PromptusRequest<EnrichPromptusResponse> {
  public tools: ToolDeclaration[] = [];
  public config: Partial<GenerateContentConfig>;
  private readonly _model = 'gemini-3.1-flash-lite'; // 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = ''; // This will be cached prior to the request
  private readonly _query: string;
  public cache: CachedContent;
  public history: Content[] = [];

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'ARRAY',
      description: 'A list of song ID and enriched metadata.',
      items: {
        type: 'OBJECT',
        properties: {
          id: {
            type: 'STRING',
            description: 'The identifier of the song',
          },
          genre: {
            type: 'STRING',
            description: 'the genre of the song',
          },
          language: {
            type: 'STRING',
            description: 'the language of the song',
          },
          country: {
            type: 'STRING',
            description: 'the country of origin',
          },
          emotion: {
            type: 'STRING',
            description: 'the emotion of the song',
          },
          pace: {
            type: 'STRING',
            description: 'the pace of the song',
          },
          year: {
            type: 'STRING',
            description: 'the release year of the song',
          },
        },
        required: ['id', 'genre', 'language', 'country', 'emotion', 'pace', 'year'],
      },
    },
  };

  get model(): string {
    return this._model;
  }

  get role(): 'user' | 'model' {
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
