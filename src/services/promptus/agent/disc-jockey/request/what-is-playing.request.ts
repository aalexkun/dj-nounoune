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
  /** Controlled vocabulary from `src/lexic/songs.description.ts`, written by the enrichment pass. */
  emotion?: string;
  /** The BPM-band pace name, same vocabulary. It sets the rhythm of the prose, not just the subject. */
  pace?: string;
  country?: string;
  language?: string;
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
   * Nothing here widens the sampling. This request once carried `topP = 0.98` / `topK = 100`
   * against the complaint that it settles into the same openings and the same anecdotes night after
   * night, but the sampling parameters are deprecated on the Gemini API: no effect since Gemini 3.6
   * Flash, an error on the models after it. Variety therefore rests on the prompt alone: the
   * "Vary Yourself" section of `WhatIsPlayingPrompt`, and the per-song scene built below, which is
   * what makes one record's entry read unlike the last one. Still repetitive? Sharpen those, there is
   * no knob left to turn.
   */
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
    this._query = `${WhatIsPlayingRequest.scene(options)}

${query}`;

    if (options?.withoutCurrentSongTool) {
      this.tools = [];
    }
  }

  /**
   * What makes this song's entry read differently from the last one. Every field here is a property
   * of the recording, so the same song always produces the same scene — which is the point.
   *
   * Deliberately carries no clock, no date and no season. `PlaylogService.resolveCommentary` writes
   * the commentary once and serves it to every later play, so a line about a Friday evening would
   * still be on screen on a Tuesday morning. Variety has to come from what differs between songs,
   * not between plays.
   *
   * It travels in the query rather than the system instruction: the instruction explains how to read
   * a scene and stays constant, the scene is per-song. Same split as `ArtistPerformanceRequest`.
   *
   * Most of the library carries only some of these fields, so each line is omitted when empty rather
   * than sent blank — a bare label reads as "this song has no mood".
   */
  private static scene(options?: WhatIsPlayingOptions): string {
    const lines = ['Scene:'];
    const add = (label: string, value?: string) => {
      if (value?.trim()) lines.push(`${label}: ${value.trim()}`);
    };

    add('What the song is about', options?.lyricSemantic);
    add('Emotional register', options?.emotion);
    add('Pace', options?.pace);
    add('Country of origin', options?.country);
    add('Sung in', options?.language);

    // Nothing known beyond the title. Say so, rather than leaving a bare `Scene:` label behind,
    // which reads as an empty form and invites the model to invent something to fill it.
    if (lines.length === 1) {
      return 'Scene: the library knows nothing about this recording beyond what the request names.';
    }

    return lines.join('\n');
  }
}
