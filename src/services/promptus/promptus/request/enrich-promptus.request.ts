import { GenerateContentConfig, CachedContent } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { EnrichPromptusResponse } from '../response/enrich.promptus.response';

export class EnrichPromptusRequest extends PromptusRequest<EnrichPromptusResponse> {
  public config: Partial<GenerateContentConfig>;
  private readonly _model = 'gemini-flash-lite-latest';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/enrich-promptus.request.md';
  private readonly _query: string;
  public cache: CachedContent;

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'ARRAY',
      description: 'A list of if and genres.',
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
        },
        required: ['id', 'genre'],
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
