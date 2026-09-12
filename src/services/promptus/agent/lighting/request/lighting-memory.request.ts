import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { GEMINI_FLASH_LITE } from '../../../config';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { LightingMemoryResponse } from '../response/lighting-memory.response';
import { lightingMemoryPrompt } from './lighting-memory.prompt';
import { LightingMemoryEntry } from '../../../../../schemas/lighting-memory.schema';

/** The request just served, as the summariser sees it. */
export interface LightingMemoryTurn {
  request: string;
  actions: string[];
  reply: string;
}

/** A reply longer than this is not what the memory is about. */
const MAX_REPLY_CHARS = 500;

/**
 * Rewrites the household's lighting notebook after a request.
 *
 * Same economics as `ChatTitleRequest`: it runs after every lighting request and beside the user's
 * path, so Flash Lite at `ThinkingLevel.LOW` with a one-field structured response. Plain shape, no
 * tools, and never registered as one — nothing a user says should rewrite the notebook directly;
 * they change it by asking for lights and correcting the result.
 */
export class LightingMemoryRequest extends PromptusRequest<LightingMemoryResponse> {
  public tools: ToolDeclaration[] = [];
  public cache?: CachedContent = undefined;
  public history: Content[] = [];
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.LOW,
    },
  };

  private readonly _model = GEMINI_FLASH_LITE;
  private readonly _role: RequestRole = 'user';
  private readonly _context = lightingMemoryPrompt;
  private readonly _query: string;

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        summary: {
          type: 'STRING',
          description:
            'The rewritten notebook, complete: preferences, corrections, vocabulary and habits of this household, under 1200 characters. Everything the previous summary held that still stands, plus what this request taught.',
        },
      },
      propertyOrdering: ['summary'],
      required: ['summary'],
    },
  };

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

  constructor(previousSummary: string, recent: LightingMemoryEntry[], turn: LightingMemoryTurn) {
    super();

    const log = recent.map((entry) => `- "${entry.request}" -> ${entry.actions.length > 0 ? entry.actions.join('; ') : 'no change made'}`);

    this._query = [
      '# PREVIOUS SUMMARY',
      previousSummary.trim() || '(empty)',
      '',
      '# RECENT REQUESTS',
      ...(log.length > 0 ? log : ['(none)']),
      '',
      '# THIS REQUEST',
      `request: ${turn.request.trim()}`,
      `actions: ${turn.actions.length > 0 ? turn.actions.join('; ') : 'no change made'}`,
      `reply: ${turn.reply.trim().slice(0, MAX_REPLY_CHARS)}`,
    ].join('\n');
  }
}
