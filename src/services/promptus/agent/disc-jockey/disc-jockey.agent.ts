import { Agent } from '../../agent';
import { Logger } from '@nestjs/common';
import { ToolsService } from '../../tools.service';
import { PromptusRequest } from '../../promptus.request';
import { GenerateContentResponse } from '@google/genai';
import { CreatePlaylistRequest } from './request/create-playlist.request';
import { CreatePlaylistResponse } from './response/create-playlist.response';
import { WhatIsPlayingRequest } from './request/what-is-playing.request';
import { WhatIsPlayingResponse } from './response/what-is-playing.response';
import { CategorisePlaylistRequest } from './request/categorise-playlist.request';
import { CategorisePlaylistResponse } from './response/categorise-playlist.response';
import { FindBestArrangementRequest } from './request/find-best-arrangement.request';
import { FindBestArrangementResponse } from './response/find-best-arrangement.response';
import { PostFilteringRequest } from './request/post-filtering.request';
import { PostFilteringResponse } from './response/post-filtering.response';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type MusicSearchResult = {
  id: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string;
};

export function isMusicSearchResult(obj: unknown): obj is MusicSearchResult {
  // Check if it's a non-null object
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  // Cast to a record to check properties safely
  const record = obj as Record<string, unknown>;

  // Validate that all required properties exist and are strings
  return (
    typeof record.id === 'string' &&
    typeof record.sourceId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.artist === 'string' &&
    typeof record.album === 'string'
  );
}

export class DiscJockeyAgent extends Agent {
  name = 'MusicSearchAgent';
  protected readonly logger = new Logger(this.name);

  constructor(
    apiKey: string,
    toolService: ToolsService,
    protected eventEmitter: EventEmitter2,
  ) {
    super();
    this.initialiseAgent(apiKey, toolService, eventEmitter);
  }

  async createPlaylist(naturalLanguageRequest: string, sessionId?: string) {
    // Step 1
    const categorisedInfo = await this.categorisePlaylist(naturalLanguageRequest, sessionId);



    const djRequest = new CreatePlaylistRequest(naturalLanguageRequest);
    return await this.generate(djRequest, sessionId);
  }

  async whatIsPlaying(request: string, sessionId?: string) {
    const wip = new WhatIsPlayingRequest(request);
    return await this.generate(wip, sessionId);
  }

  async categorisePlaylist(request: string, sessionId?: string) {
    const djRequest = new CategorisePlaylistRequest(request);
    return await this.generate(djRequest, sessionId);
  }

  async findBestArrangement(request: string, sessionId?: string) {
    const djRequest = new FindBestArrangementRequest(request);
    return await this.generate(djRequest, sessionId);
  }

  async postFiltering(request: string, sessionId?: string) {
    const djRequest = new PostFilteringRequest(request);
    return await this.generate(djRequest, sessionId);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof CreatePlaylistRequest) {
      return new CreatePlaylistResponse(response) as ReqType;
    }
    if (request instanceof WhatIsPlayingRequest) {
      return new WhatIsPlayingResponse(response) as ReqType;
    }
    if (request instanceof CategorisePlaylistRequest) {
      return new CategorisePlaylistResponse(response) as ReqType;
    }
    if (request instanceof FindBestArrangementRequest) {
      return new FindBestArrangementResponse(response) as ReqType;
    }
    if (request instanceof PostFilteringRequest) {
      return new PostFilteringResponse(response) as ReqType;
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }
}
