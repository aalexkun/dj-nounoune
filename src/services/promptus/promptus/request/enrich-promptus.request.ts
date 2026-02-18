import { GenerateContentConfig } from '@google/genai';
import { CacheRequest, PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { EnrichPromptusResponse } from '../response/enrich.promptus.response';

export class EnrichPromptusRequest extends PromptusRequest<EnrichPromptusResponse> {
  public structuredResponse?: StructuredResponse | undefined;
  public config: Partial<GenerateContentConfig>;
  private readonly _model = 'gemini-flash-lite-latest';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/enrich-promptus.request.md';
  private readonly _query: string;
  public cache: CacheRequest;

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
