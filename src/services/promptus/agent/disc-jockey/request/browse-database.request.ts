import { GEMINI_FLASH } from '../../../config';
import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { AgentToolsDefinition } from '../../../tools/definition/agent-tools.definition';
import { browseDatabasePrompt } from './browse-database.prompt';
import { BrowseDatabaseResponse } from '../response/browse-database.response';

export class BrowseDatabaseRequest extends PromptusRequest<BrowseDatabaseResponse> {
  public tools: ToolDeclaration[] = [AgentToolsDefinition.searchMusicDatabase];
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      description: 'An object containing a description and a list of items found in the database.',
      properties: {
        description: {
          type: 'STRING',
          description: 'A human-readable summary of the browsing results.',
        },
        items: {
          type: 'ARRAY',
          description: 'A list of songs, artists, or albums found.',
          items: {
            type: 'OBJECT',
            properties: {
              id: {
                type: 'STRING',
                description: 'The identifier of the item',
              },
              title: {
                type: 'STRING',
                description: 'The title of the song or album',
              },
              artist: {
                type: 'STRING',
                description: 'The artist name',
              },
              album: {
                type: 'STRING',
                description: 'The album name',
              },
            },
            required: ['id', 'artist'],
          },
        },
      },
      required: ['description', 'items'],
    },
  };
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = GEMINI_FLASH;
  private readonly _role: RequestRole = 'user';
  private readonly _context: string = browseDatabasePrompt;
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
