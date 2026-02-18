import { GenerateContentConfig } from '@google/genai';
import { CacheRequest, PromptusRequest, RequestRole, StructuredResponse } from './PromptusRequest';
import { SearchPromptusResponse } from '../response/SearchPromptusResponse';

export class SearchPromptusRequest extends PromptusRequest<SearchPromptusResponse> {
  public structuredResponse?: StructuredResponse | undefined;
  public config: Partial<GenerateContentConfig>;
  public cache?: CacheRequest;
  private readonly _model = 'gemini-flash-lite-latest';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/SearchPromptusRequest.md';
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
