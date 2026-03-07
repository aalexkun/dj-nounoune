import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { ChatTitlePromptusResponse } from '../response/chat-title.promptus.response';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { ToolDeclaration } from '../tools/tool.type';

export class ChatTitlePromptusRequest extends PromptusRequest<ChatTitlePromptusResponse> {
  cache: CachedContent;
  config: Partial<GenerateContentConfig>;
  context: string;
  model: string;
  query: string;
  role: RequestRole;
  structuredResponse: StructuredResponse;
  tools: ToolDeclaration[];
  history: Content[] = [];
}
