import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { AlbumCoverResponse } from '../response/album-cover.response';
import { AlbumCoverPrompt } from './album-cover.prompt';

/**
 * Grounded lookup: the model searches the web for the release and answers with the artwork URL.
 * It declares no function tools — Gemini does not accept those alongside Google Search grounding.
 */
export class AlbumCoverRequest extends PromptusRequest<AlbumCoverResponse> {
  public tools: ToolDeclaration[] = [];

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        url: {
          type: 'STRING',
          description:
            'image url — the address of the cover image file itself, not of the page displaying it. ' +
            'Empty when the searches surfaced no cover image.',
        },
      },
      propertyOrdering: ['url'],
      required: ['url'],
    },
  };
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
    },
  };
  public cache?: CachedContent;
  public history: Content[] = [];
  public grounded = true;
  private readonly _model = 'gemini-flash-latest';
  private readonly _role: RequestRole = 'user';
  private readonly _context = AlbumCoverPrompt;
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

  constructor(artist: string, album: string) {
    super();
    this._query = `artist: ${artist}
album: ${album}`;
  }
}
