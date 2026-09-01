import { GEMINI_FLASH_LITE } from '../../../config';
import { WhatIsPlayingResponse } from '../response/what-is-playing.response';
import { PromptusRequest, RequestRole } from '../../../promptus.request';
import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { MpdToolsDefinition } from '../../../tools/definition/mpd-tools.definition';
import { WhatIsPlayingPrompt } from './what-is-playing.prompt';

export class WhatIsPlayingRequest extends PromptusRequest<WhatIsPlayingResponse> {
  public tools = [MpdToolsDefinition.currentMpdCommand];
  public structuredResponse = undefined;
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MEDIUM,
    },
  };
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
   * @param options.withoutCurrentSongTool drop the MPD tool so the answer can only describe the track
   *   named in the query. The tool reports whatever is playing at the moment the model calls it, which
   *   is later than the moment the caller asked — for a specific track that is the wrong answer.
   */
  constructor(query: string, options?: { withoutCurrentSongTool?: boolean }) {
    super();
    this._query = query;

    if (options?.withoutCurrentSongTool) {
      this.tools = [];
    }
  }
}
