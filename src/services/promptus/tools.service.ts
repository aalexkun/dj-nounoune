import { FunctionCall } from '@google/genai';
import { Injectable } from '@nestjs/common';

import { FunctionCallResult, ToolHandler } from './tools/tool.type';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { MusicDbService } from '../music-db/music-db.service';
import { PlayMusicHandler } from './tools/handler/mpd/play-music.handler';
import { StopPlaybackHandler } from './tools/handler/mpd/stop-music.handler';
import { CurrentSongHandler } from './tools/handler/mpd/current-song.handler';
import { CurrentPlaylistHandler } from './tools/handler/mpd/current-playlist.handler';
import { GenreDistributionHandler } from './tools/handler/mongo/genre-distribution.handler';
import { ArtistDistributionHandler } from './tools/handler/mongo/artist-distribution.handler';
import { BPMDistributionHandler } from './tools/handler/mongo/bpm-distribution.handler';
import { DiscJockeyAgent } from './agent/disc-jockey/disc-jockey.agent';
import { DiscJockeyCreatePlaylistHandler } from './tools/handler/agent/disc-jockey-create-playlist.handler';
import { QueryDatabaseAgent } from './agent/query-database/query-database.agent';
import { QueryDatabaseHandler } from './tools/handler/agent/query-database.handler';
import { DiscJockeyWhatIsPlayingHandler } from './tools/handler/agent/disc-jockey-what-is-playing.handler';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ToolsService {
  private toolRegistry = new Map<string, ToolHandler>();

  constructor(
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
  ) {
    // Generic and global accessible Tool and function
    this.registerTool(new PlayMusicHandler(this.mpdClientService));
    this.registerTool(new StopPlaybackHandler(this.mpdClientService));
    this.registerTool(new CurrentSongHandler(this.mpdClientService));
    this.registerTool(new CurrentPlaylistHandler(this.mpdClientService));
    this.registerTool(new GenreDistributionHandler(this.musicDbService));
    this.registerTool(new ArtistDistributionHandler(this.musicDbService));
    this.registerTool(new BPMDistributionHandler(this.musicDbService));
  }

  initialiseAgent(apiKey: string, eventEmitter: EventEmitter2) {
    // const chatTitleAgent = new ChatTitleAgent(apiKey, this, this.chatService);
    // this.registerTool(new ChatTitleHandler(chatTitleAgent));

    const discJokeyAgent = new DiscJockeyAgent(apiKey, this, eventEmitter);
    this.registerTool(new DiscJockeyCreatePlaylistHandler(discJokeyAgent));
    this.registerTool(new DiscJockeyWhatIsPlayingHandler(discJokeyAgent));

    const queryDatabaseAgent = new QueryDatabaseAgent(apiKey, this, eventEmitter, this.musicDbService);
    this.registerTool(new QueryDatabaseHandler(queryDatabaseAgent));
  }

  private registerTool(handler: ToolHandler) {
    this.toolRegistry.set(handler.name, handler);
  }

  public async proceedFunctionCall(fc: FunctionCall, sessionId?: string): Promise<FunctionCallResult> {
    if (!fc.name) {
      throw new Error(`Unsupported function call: ${fc}`);
    }

    const handler = this.toolRegistry.get(fc.name);

    if (!handler) {
      throw new Error(`Unsupported function call: ${fc.name}`);
    }

    return await handler.execute(fc.args, sessionId);
  }
}
