import { PromptusRequest, RequestRole, StructuredResponse } from './promptus.request';
import { ChatPromptusResponse } from '../response/chat.promptus.response';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { MpdTools } from '../tools/mpd.tools';
import { ToolDeclaration } from '../tools/tool.type';
import { ChatMessage } from '../../../../schemas/chat.schema';
import { MongoTools } from '../tools/mongo.tools';

export class ChatPromptusRequest extends PromptusRequest<ChatPromptusResponse> {
  public query: string;
  public tools: ToolDeclaration[] = [
    MpdTools.playMpdCommand,
    MpdTools.stopMpdCommand,
    MpdTools.currentMpdCommand,
    MpdTools.playlistMpdCommand,
    MongoTools.queryMusicDatabase,
    MongoTools.artistDistribution,
    MongoTools.bpmDistribution,
    MongoTools.genreDistribution,
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
