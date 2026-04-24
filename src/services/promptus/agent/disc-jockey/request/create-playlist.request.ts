import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { CreatePlaylistResponse } from '../response/create-playlist.response';
import { ToolDeclaration } from '../../../tools/tool.type';
import { MongoToolsDefinition } from '../../../tools/definition/mongo-tools.definition';
import { AgentToolsDefinition } from '../../../tools/definition/agent-tools.definition';
import { createPlaylistPrompt } from './create-playlist.prompt';

export class CreatePlaylistRequest extends PromptusRequest<CreatePlaylistResponse> {
  public tools: ToolDeclaration[] = [
    MongoToolsDefinition.artistDistribution,
    MongoToolsDefinition.bpmDistribution,
    MongoToolsDefinition.genreDistribution,
    AgentToolsDefinition.searchMusicDatabase,
  ];
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      description: 'An object containing a description and a list of songs.',
      properties: {
        description: {
          type: 'STRING',
          description: 'A description of the returned data',
        },
        items: {
          type: 'ARRAY',
          description: 'A list of songs.',
          items: {
            type: 'OBJECT',
            properties: {
              id: {
                type: 'STRING',
                description: 'The identifier of the song',
              },
              sourceId: {
                type: 'STRING',
                description: 'The source identifier of the song',
              },
              title: {
                type: 'STRING',
                description: 'The title of the song',
              },
              artist: {
                type: 'STRING',
                description: 'The artist of the song',
              },
              album: {
                type: 'STRING',
                description: 'The album the song belongs to',
              },
            },
            required: ['id', 'sourceId', 'title', 'artist', 'album'],
          },
        },
      },
      required: ['description', 'items'],
    },
  };
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = createPlaylistPrompt;
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
