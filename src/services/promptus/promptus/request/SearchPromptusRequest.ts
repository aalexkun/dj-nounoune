import { GenerateContentConfig } from '@google/genai';
import { PromptusRequest, RequestRole } from './PromptusRequest';
import { SearchPromptusResponse } from '../response/SearchPromptusResponse';

export class SearchPromptusRequest extends PromptusRequest<SearchPromptusResponse> {
  public config: Partial<GenerateContentConfig>;
  private _model = 'gemini-flash-lite-latest';
  private _role: RequestRole = 'user';
  private _context = 'src/PromptusEngine/contexts/search-prompt.md';
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
