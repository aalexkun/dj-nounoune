import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { CreatePlaylistResponse } from '../response/create-playlist.response';
import { ToolDeclaration } from '../../../tools/tool.type';
import { MongoToolsDefinition } from '../../../tools/definition/mongo-tools.definition';
import { AgentToolsDefinition } from '../../../tools/definition/agent-tools.definition';

export class CreatePlaylistRequest extends PromptusRequest<CreatePlaylistResponse> {
  public tools: ToolDeclaration[] = [
    MongoToolsDefinition.artistDistribution,
    MongoToolsDefinition.bpmDistribution,
    MongoToolsDefinition.genreDistribution,
    AgentToolsDefinition.searchMusicDatabase,
  ];
  public structuredResponse?: StructuredResponse | undefined;
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = 'src/services/promptus/agent/disc-jockey/request/create-playlist.request.md';
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
