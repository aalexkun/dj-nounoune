import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { ArtistPerformanceResponse } from '../response/artist-performance.response';
import { ArtistPerformancePrompt } from './artist-performance.prompt';

/**
 * Grounded lookup: tour dates only exist on the live web, so this one searches rather than recalls.
 * It declares no function tools and no structured response — Gemini accepts neither alongside
 * Google Search grounding.
 */
export class ArtistPerformanceRequest extends PromptusRequest<ArtistPerformanceResponse> {
  public tools: ToolDeclaration[] = [];
  public structuredResponse: StructuredResponse | undefined = undefined;
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MEDIUM,
    },
  };
  public cache?: CachedContent;
  public history: Content[] = [];
  public grounded = true;
  private readonly _model = 'gemini-flash-latest';
  private readonly _role: RequestRole = 'user';
  private readonly _context = ArtistPerformancePrompt;
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

  /**
   * @param query the request, naming the artist and optionally a region or a window of time.
   * @param today the current date, injected because "upcoming" is meaningless to a model whose
   *   knowledge stops well before now — without it, past dates come back as future ones.
   */
  constructor(query: string, today: Date = new Date()) {
    super();
    this._query = `Current date: ${today.toISOString().slice(0, 10)}

${query}`;
  }
}
