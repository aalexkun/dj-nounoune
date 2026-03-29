import { Agent } from '../../agent';
import { Logger } from '@nestjs/common';
import { ToolsService } from '../../tools.service';
import { PromptusRequest } from '../../promptus.request';
import { GenerateContentResponse } from '@google/genai';
import { CreatePlaylistRequest } from './request/create-playlist.request';
import { CreatePlaylistResponse } from './response/create-playlist.response';
import { WhatIsPlayingRequest } from './request/what-is-playing.request';
import { WhatIsPlayingResponse } from './response/what-is-playing.response';

export type MusicSearchResult = {
  id: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string;
};

export class DiscJockeyAgent extends Agent {
  name = 'MusicSearchAgent';
  protected readonly logger = new Logger(this.name);

  constructor(apiKey: string, toolService: ToolsService) {
    super();
    this.initialiseAgent(apiKey, toolService);
  }

  async createPlaylist(naturalLanguageRequest: string) {
    const djRequest = new CreatePlaylistRequest(naturalLanguageRequest);
    return await this.generate(djRequest);
  }

  async whatIsPlaying(request: string) {
    const wip = new WhatIsPlayingRequest(request);
    return await this.generate(wip);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof CreatePlaylistRequest) {
      return new CreatePlaylistResponse(response) as ReqType;
    }
    if (request instanceof WhatIsPlayingRequest) {
      return new WhatIsPlayingResponse(response) as ReqType;
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }
}
