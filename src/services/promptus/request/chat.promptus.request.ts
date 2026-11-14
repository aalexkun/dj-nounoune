import { GEMINI_FLASH } from '../config';
import { PromptusRequest, RequestRole, StructuredResponse } from '../promptus.request';
import { ChatPromptusResponse } from '../response/chat.promptus.response';
import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { ToolDeclaration } from '../tools/tool.type';
import { chatPromptusPrompt } from './chat-promptus.prompt';

import { MpdToolsDefinition } from '../tools/definition/mpd-tools.definition';
import { ChatMessage } from '../../../schemas/chat.schema';
import { AgentToolsDefinition } from '../tools/definition/agent-tools.definition';
import { QobuzToolsDefinition } from '../tools/definition/qobuz-tools.definition';
import { SpotifyToolsDefinition } from '../tools/definition/spotify-tools.definition';
import { YoutubeToolsDefinition } from '../tools/definition/youtube-tools.definition';

export class ChatPromptusRequest extends PromptusRequest<ChatPromptusResponse> {
  public query: string;
  public tools: ToolDeclaration[] = [
    MpdToolsDefinition.playMpdCommand,
    MpdToolsDefinition.stopMpdCommand,
    MpdToolsDefinition.nextMpdCommand,
    MpdToolsDefinition.previousMpdCommand,
    MpdToolsDefinition.currentMpdCommand,
    AgentToolsDefinition.discJockeyWhatIsPlaying,
    AgentToolsDefinition.discJockeyCreatePlaylist,
    AgentToolsDefinition.discJockeyBrowseDatabase,
    AgentToolsDefinition.discJockeyArtistPerformance,
    AgentToolsDefinition.discJockeyTalkAboutMusic,
    QobuzToolsDefinition.searchArtistCommand,
    QobuzToolsDefinition.findArtistTrackCommand,
    QobuzToolsDefinition.playCommand,
    QobuzToolsDefinition.favoriteCommand,
    SpotifyToolsDefinition.searchArtistCommand,
    SpotifyToolsDefinition.searchMusicCommand,
    SpotifyToolsDefinition.playCommand,
    YoutubeToolsDefinition.searchMusicCommand,
    YoutubeToolsDefinition.playCommand,
    YoutubeToolsDefinition.importCommand,
    AgentToolsDefinition.lightingDesigner,
  ];
  /**
   * The user-facing conversation: a long instruction, a dozen tools and a routing decision on every
   * turn. MEDIUM is the floor it needs; HIGH, the model default, is paid on every message.
   */
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MEDIUM,
    },
  };
  public structuredResponse?: StructuredResponse | undefined;
  private readonly _model = GEMINI_FLASH;
  private readonly _role: RequestRole = 'user';
  private readonly _context = chatPromptusPrompt;

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
