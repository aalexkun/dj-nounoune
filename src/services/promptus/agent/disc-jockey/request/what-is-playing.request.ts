import { WhatIsPlayingResponse } from '../response/what-is-playing.response';
import { PromptusRequest, RequestRole } from '../../../promptus.request';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';
import { MpdToolsDefinition } from '../../../tools/definition/mpd-tools.definition';
import { WhatIsPlayingPrompt } from './what-is-playing.prompt';

export class WhatIsPlayingRequest extends PromptusRequest<WhatIsPlayingResponse> {
  public tools = [MpdToolsDefinition.currentMpdCommand];
  public structuredResponse = undefined;
  public config: Partial<GenerateContentConfig> = {};
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
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

  constructor(query: string) {
    super();
    this._query = query;
  }
}
