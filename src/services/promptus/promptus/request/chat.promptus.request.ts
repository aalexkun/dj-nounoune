import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { ChatPromptusResponse } from '../response/chat.promptus.response';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { ToolDeclaration } from '../tools/tool.type';
import { ChatMessage } from '../../../../schemas/chat.schema';
import { MpdToolsDefinition } from '../tools/definition/mpd-tools.definition';
import { MongoToolsDefinition } from '../tools/definition/mongo-tools.definition';

export class ChatPromptusRequest extends PromptusRequest<ChatPromptusResponse> {
  public query: string;
  public tools: ToolDeclaration[] = [
    MpdToolsDefinition.playMpdCommand,
    MpdToolsDefinition.stopMpdCommand,
    MpdToolsDefinition.currentMpdCommand,
    MpdToolsDefinition.playlistMpdCommand,
    MongoToolsDefinition.queryMusicDatabase,
    MongoToolsDefinition.artistDistribution,
    MongoToolsDefinition.bpmDistribution,
    MongoToolsDefinition.genreDistribution,
  ];
  public config: Partial<GenerateContentConfig>;
  public structuredResponse?: StructuredResponse | undefined;
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/promptus/request/chat-promptus.request.md';

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

  public history: Content[] = [];

  constructor(query: string, history: ChatMessage[]) {
    super();

    this.history = [
      ...history,
      {
        role: 'user',
        parts: [{ text: query }],
      },
    ];

    this.query = query;
  }
}
