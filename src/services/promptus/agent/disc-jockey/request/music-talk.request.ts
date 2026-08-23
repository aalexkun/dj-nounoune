import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { MusicTalkResponse } from '../response/music-talk.response';
import { MusicTalkPrompt } from './music-talk.prompt';

/**
 * Plain conversation about music, grounded on Google Search so an answer about anything recent is
 * checked rather than recalled. Grounding rules out function tools and a structured response, which
 * suits this one: it never touches the library and it answers in prose.
 */
export class MusicTalkRequest extends PromptusRequest<MusicTalkResponse> {
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
  private readonly _context = MusicTalkPrompt;
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
