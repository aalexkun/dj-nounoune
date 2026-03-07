import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { SearchPromptusResponse } from '../response/search.promptus.response';
import { ToolDeclaration } from '../tools/tool.type';

export class SearchPromptusRequest extends PromptusRequest<SearchPromptusResponse> {
  public tools: ToolDeclaration[] = [];
  public structuredResponse?: StructuredResponse | undefined;
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-flash-lite-latest';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/search.promptus.request.md';
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
