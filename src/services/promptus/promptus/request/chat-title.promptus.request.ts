import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { ChatTitlePromptusResponse } from '../response/chat-title.promptus.response';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { ToolDeclaration } from '../tools/tool.type';

export class ChatTitlePromptusRequest extends PromptusRequest<ChatTitlePromptusResponse> {
  cache: CachedContent;
  config: Partial<GenerateContentConfig>;
  query: string;

  structuredResponse: StructuredResponse;
  tools: ToolDeclaration[];
  history: Content[] = [];

  get role(): RequestRole {
    return this._role;
  }

  get model(): string {
    return this._model;
  }

  get context(): string {
    return this._context;
  }

  private _role: RequestRole = 'user';
  private _model = 'gemini-3-flash-preview';
  private _context = 'src/services/promptus/promptus/request/chat-title.promptus.request.md';

  constructor(chatroomName: string) {
    super();
    this.query = chatroomName;
  }
}
