import { FunctionCall } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { MpdClientService } from '../../../mpd-client/mpd-client.service';
import { PlayMusicHandler } from './handler/mpd/play-music.handler';
import { StopPlaybackHandler } from './handler/mpd/stop-music.handler';
import { CurrentSongHandler } from './handler/mpd/current-song.handler';
import { FunctionCallResult } from './tool.type';
import { CurrentPlaylistHandler } from './handler/mpd/current-playlist.handler';
import { MusicDbService } from '../../../music-db/music-db.service';
import { MusicSearchHandler } from '../handler/music-search.handler';
import { GenreDistributionHandler } from './handler/mongo/genre-distribution.handler';
import { ArtistDistributionHandler } from './handler/mongo/artist-distribution.handler';
import { BPMDistributionHandler } from './handler/mongo/bpm-distribution.handler';
import { QueryMusicDatabaseHandler } from './handler/mongo/query-music-database.handler';
import { PromptusService } from '../promptus.service';

export interface ToolHandler {
  name: string;
  execute(args: any): Promise<FunctionCallResult>;
}

@Injectable()
export class ToolsService {
  private toolRegistry = new Map<string, ToolHandler>();
  private musicSearchHandler: MusicSearchHandler;

  constructor(
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
  ) {
    this.registerTool(new PlayMusicHandler(this.mpdClientService));
    this.registerTool(new StopPlaybackHandler(this.mpdClientService));
    this.registerTool(new CurrentSongHandler(this.mpdClientService));
    this.registerTool(new CurrentPlaylistHandler(this.mpdClientService));
    this.registerTool(new GenreDistributionHandler(this.musicDbService));
    this.registerTool(new ArtistDistributionHandler(this.musicDbService));
    this.registerTool(new BPMDistributionHandler(this.musicDbService));
  }
  /* Agent as Tool require promptus service, to manage the dep this is initialise from promptus service  */
  initialiseAgentTool(promptusService: PromptusService) {
    this.musicSearchHandler = new MusicSearchHandler(promptusService, this.musicDbService);
    this.registerTool(new QueryMusicDatabaseHandler(this.musicSearchHandler));
  }

  private registerTool(handler: ToolHandler) {
    this.toolRegistry.set(handler.name, handler);
  }

  public async proceedFunctionCall(fc: FunctionCall): Promise<FunctionCallResult> {
    if (!fc.name) {
      throw new Error(`Unsupported function call: ${fc}`);
    }

    const handler = this.toolRegistry.get(fc.name);

    if (!handler) {
      throw new Error(`Unsupported function call: ${fc.name}`);
    }

    return await handler.execute(fc.args);
  }
}
