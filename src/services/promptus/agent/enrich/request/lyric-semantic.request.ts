import { GEMINI_FLASH } from '../../../config';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { LyricSemanticResponse } from '../response/lyric-semantic.response';
import { lyricSemanticPrompt } from './lyric-semantic.prompt';

/**
 * One song per request. The instruction fixes the output at exactly one sentence, so batching
 * would mean rewriting the constraint; concurrency comes from `parallelGenerate` instead.
 *
 * Deliberately uncached: the instruction is a few hundred tokens, far below what a cache pays for.
 */
export class LyricSemanticRequest extends PromptusRequest<LyricSemanticResponse> {
  public tools: ToolDeclaration[] = [];
  public config: Partial<GenerateContentConfig> = {};
  public cache?: CachedContent = undefined;
  public history: Content[] = [];
  private readonly _model = GEMINI_FLASH;
  private readonly _role: RequestRole = 'user';
  private readonly _context = lyricSemanticPrompt;
  private readonly _query: string;

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        semantic: {
          type: 'STRING',
          description: 'One dense, declarative, grammatically complete sentence of 20-35 words. No prefix.',
        },
      },
      propertyOrdering: ['semantic'],
      required: ['semantic'],
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

  constructor(artist: string, title: string) {
    super();
    this._query = `${artist} - ${title}`;
  }
}
