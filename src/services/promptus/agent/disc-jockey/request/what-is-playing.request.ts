import { GEMINI_FLASH_LITE } from '../../../config';
import { WhatIsPlayingResponse } from '../response/what-is-playing.response';
import { PromptusRequest, RequestRole } from '../../../promptus.request';
import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { MpdToolsDefinition } from '../../../tools/definition/mpd-tools.definition';
import { WhatIsPlayingPrompt } from './what-is-playing.prompt';

export interface WhatIsPlayingOptions {
  /**
   * Drop the MPD tool so the answer can only describe the track named in the query. The tool reports
   * whatever is playing at the moment the model calls it, which is later than the moment the caller
   * asked — for a specific track that is the wrong answer.
   */
  withoutCurrentSongTool?: boolean;
  /**
   * The song's one-sentence lyric distillation, when the enrichment pass has produced one. It is the
   * scene's mood source: it decides the emotional register of the whole answer, which the genre tag
   * alone cannot. Absent for the bulk of the library, and the scene degrades to the clock alone.
   */
  lyricSemantic?: string;
  /** Injectable clock, so a caller (or a test) can pin the scene instead of reading the wall time. */
  now?: Date;
}

export class WhatIsPlayingRequest extends PromptusRequest<WhatIsPlayingResponse> {
  public tools = [MpdToolsDefinition.currentMpdCommand];
  public structuredResponse = undefined;
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MEDIUM,
    },
  };

  /**
   * Widened on purpose, and only here. This prompt answers about the same few hundred songs night
   * after night in one fixed voice, and at the library defaults it settles into the same openings and
   * the same anecdotes — the complaint this request exists to fix. A wider nucleus lets the
   * second-choice phrasing through, which is where the variety comes from.
   *
   * A deliberately small first step: `topP` sits just above the ~0.95 default rather than at 1.0,
   * which would also admit genuinely broken continuations, and `topK` is lifted clear so it is never
   * the binding constraint. Still repetitive? Raise `topP` towards 0.99 before touching anything
   * else, and reach for `config.temperature` only after that.
   */
  public topP = 0.98;
  public topK = 100;

  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = GEMINI_FLASH_LITE;
  private readonly _role: RequestRole = 'user';
  private readonly _context = WhatIsPlayingPrompt;
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

  /**
   * @param query the question, which may name the track to analyse.
   * @param options see {@link WhatIsPlayingOptions}.
   */
  constructor(query: string, options?: WhatIsPlayingOptions) {
    super();
    this._query = `${WhatIsPlayingRequest.scene(options?.now ?? new Date(), options?.lyricSemantic)}

${query}`;

    if (options?.withoutCurrentSongTool) {
      this.tools = [];
    }
  }

  /**
   * The one thing that differs between two plays of the same record, and therefore the only lever
   * that varies the answer by itself — the sampling knobs above only shuffle the wording.
   *
   * It travels in the query rather than the system instruction: the instruction explains how to read
   * a scene and stays constant, the scene is per-call. Same split as `ArtistPerformanceRequest`,
   * which is handed the current date the same way and for a related reason.
   *
   * Local time on purpose. The display this feeds sits in one room, and "a wet Tuesday morning" only
   * means anything in the listener's own hours.
   */
  private static scene(now: Date, lyricSemantic?: string): string {
    const stamp = now.toLocaleString('en-CA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const lines = [`Scene: it is ${stamp}.`];

    // Omitted rather than sent empty: a blank label reads as "this song is about nothing".
    if (lyricSemantic?.trim()) {
      lines.push(`What the song is about: ${lyricSemantic.trim()}`);
    }

    return lines.join('\n');
  }
}
