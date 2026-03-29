import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../promptus.request';
import { ChatTitleResponse } from './chat-title.response';
import { ToolDeclaration } from '../../tools/tool.type';

export class ChatTitleRequest extends PromptusRequest<ChatTitleResponse> {
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
  private _context = 'src/services/promptus/agent/chat-title/chat-title.request.md';

  constructor(chatroomName: string) {
    super();
    this.query = chatroomName;
  }
}
