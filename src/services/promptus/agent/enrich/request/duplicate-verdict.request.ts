import { GEMINI_FLASH } from '../../../config';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { DuplicateVerdictResponse } from '../response/duplicate-verdict.response';
import { duplicateVerdictPrompt } from './duplicate-verdict.prompt';

/** One side of the comparison, as the prompt renders it. Built by `DeduplicationService`. */
export interface DuplicateVerdictEntry {
  title: string;
  artist: string;
  albumArtist?: string;
  album: string;
  year?: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  sources: string[];
  isrcs: string[];
}

/**
 * One pair per request. The verdict is a single boolean with a reason, so batching pairs into
 * one call would only invite the model to cross-contaminate them; concurrency comes from
 * `parallelGenerate` instead. Plain shape: instruction in `context`, no tools, no cache.
 */
export class DuplicateVerdictRequest extends PromptusRequest<DuplicateVerdictResponse> {
  public tools: ToolDeclaration[] = [];
  public config: Partial<GenerateContentConfig> = {};
  public cache?: CachedContent = undefined;
  public history: Content[] = [];
  private readonly _model = GEMINI_FLASH;
  private readonly _role: RequestRole = 'user';
  private readonly _context = duplicateVerdictPrompt;
  private readonly _query: string;

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        same: {
          type: 'BOOLEAN',
          description:
            'True when A and B are the same recording and can be merged into one entry; false when they are different performances, different songs, or the evidence is too thin to say.',
        },
        confidence: {
          type: 'NUMBER',
          description: 'How sure you are of `same`, from 0 (a guess) to 1 (certain).',
        },
        reason: {
          type: 'STRING',
          description:
            'One sentence naming the decisive signal, e.g. "B is the 2009 remaster of the same take: durations agree and the album is the anniversary edition."',
        },
      },
      propertyOrdering: ['same', 'confidence', 'reason'],
      required: ['same', 'confidence', 'reason'],
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

  constructor(primary: DuplicateVerdictEntry, candidate: DuplicateVerdictEntry, signals: Record<string, unknown>, reasons: string[]) {
    super();
    this._query = [
      '# ENTRY A',
      DuplicateVerdictRequest.render(primary),
      '',
      '# ENTRY B',
      DuplicateVerdictRequest.render(candidate),
      '',
      '# SCORER SIGNALS',
      JSON.stringify(signals),
      '',
      '# WHY THE SCORER COULD NOT DECIDE',
      ...reasons.map((reason) => `- ${reason}`),
    ].join('\n');
  }

  private static render(entry: DuplicateVerdictEntry): string {
    const lines = [
      `title: ${entry.title}`,
      `artist: ${entry.artist}`,
      `album artist: ${entry.albumArtist ?? ''}`,
      `album: ${entry.album}`,
      `year: ${entry.year ?? ''}`,
      `track: ${entry.trackNumber ?? ''}${entry.discNumber ? ` (disc ${entry.discNumber})` : ''}`,
      `duration seconds: ${entry.duration ?? 'unknown'}`,
      `sources: ${entry.sources.join(', ') || 'none'}`,
      `isrc: ${entry.isrcs.join(', ') || 'unknown'}`,
    ];

    return lines.join('\n');
  }
}
