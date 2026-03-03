import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { ChatPromptusResponse } from '../response/chat.promptus.response';
import { CachedContent, GenerateContentConfig } from '@google/genai';
import { MpdTools } from '../tools/mpd.tools';
import { ToolDeclaration } from '../tools/tool.type';

export class ChatPromptusRequest extends PromptusRequest<ChatPromptusResponse> {
  public tools: ToolDeclaration[] = [MpdTools.playMpdCommand, MpdTools.stopMpdCommand, MpdTools.currentMpdCommand, MpdTools.playlistMpdCommand];
  public config: Partial<GenerateContentConfig>;
  public structuredResponse?: StructuredResponse | undefined;
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/chat-promptus.request.md';
  private readonly _query: string;
  public cache: CachedContent;

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
