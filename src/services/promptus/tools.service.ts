import { FunctionCall } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';

import { FunctionCallResult, ToolHandler } from './tools/tool.type';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { MusicDbService } from '../music-db/music-db.service';
import { PlayMusicHandler } from './tools/handler/mpd/play-music.handler';
import { StopPlaybackHandler } from './tools/handler/mpd/stop-music.handler';
import { NextSongHandler } from './tools/handler/mpd/next-song.handler';
import { PreviousSongHandler } from './tools/handler/mpd/previous-song.handler';
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
import { DiscJockeyBrowseDatabaseHandler } from './tools/handler/agent/disc-jockey-browse-database.handler';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { ProfilerService } from '../profiler/profiler.service';
import { FileService } from '../file/file.service';
import { OpensearchService } from '../opensearch/opensearch.service';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { QobuzService } from '../qobuz/qobuz.service';
import { YoutubeService } from '../youtube/youtube.service';
import { NowPlayingSource } from '../playlog/now-playing.event';
import { DiscJockeyArtistPerformanceHandler } from './tools/handler/agent/disc-jockey-artist-performance.handler';
import { DiscJockeyTalkAboutMusicHandler } from './tools/handler/agent/disc-jockey-talk-about-music.handler';
import { SearchQobuzArtistHandler } from './tools/handler/qobuz/search-qobuz-artist.handler';
import { FindQobuzArtistTrackHandler } from './tools/handler/qobuz/find-qobuz-artist-track.handler';
import { PlayQobuzHandler } from './tools/handler/qobuz/play-qobuz.handler';
import { FavoriteQobuzHandler } from './tools/handler/qobuz/favorite-qobuz.handler';
import { SearchYoutubeMusicHandler } from './tools/handler/youtube/search-youtube-music.handler';
import { PlayYoutubeHandler } from './tools/handler/youtube/play-youtube.handler';
import { ImportYoutubeHandler } from './tools/handler/youtube/import-youtube.handler';

@Injectable()
export class ToolsService {
  private readonly logger = new Logger('ToolsService');
  private toolRegistry = new Map<string, ToolHandler>();
  private discJockeyAgent: DiscJockeyAgent | undefined;

  /** Registered by `PlaylogService` on module init. See {@link NowPlayingSource}. */
  private nowPlayingSource: NowPlayingSource | undefined;

  constructor(
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
    private configService: ConfigService,
    private profilerService: ProfilerService,
    private fileService: FileService,
    private opensearchService: OpensearchService,
    private redisCacheService: RedisCacheService,
    private qobuzService: QobuzService,
    private youtubeService: YoutubeService,
  ) {
    // Generic and global accessible Tool and function
    this.registerTool(new PlayMusicHandler(this.mpdClientService, this.configService,this.redisCacheService));
    this.registerTool(new StopPlaybackHandler(this.mpdClientService));
    this.registerTool(new NextSongHandler(this.mpdClientService));
    this.registerTool(new PreviousSongHandler(this.mpdClientService));
    this.registerTool(new CurrentSongHandler(this.mpdClientService, this.musicDbService, () => this.nowPlayingSource));
    this.registerTool(new CurrentPlaylistHandler(this.mpdClientService));
    this.registerTool(new GenreDistributionHandler(this.musicDbService));
    this.registerTool(new ArtistDistributionHandler(this.musicDbService));
    this.registerTool(new BPMDistributionHandler(this.musicDbService));

    // Straight to the Qobuz catalog, for music the library never imported.
    this.registerTool(new SearchQobuzArtistHandler(this.qobuzService));
    this.registerTool(new FindQobuzArtistTrackHandler(this.qobuzService));
    this.registerTool(new PlayQobuzHandler(this.qobuzService, this.mpdClientService, this.configService));
    this.registerTool(new FavoriteQobuzHandler(this.qobuzService));

    // The fallback, for what Qobuz does not carry. Separate tools rather than a mode on the Qobuz
    // ones: the model has to be able to tell the user which catalog it ended up playing from.
    this.registerTool(new SearchYoutubeMusicHandler(this.youtubeService));
    this.registerTool(new PlayYoutubeHandler(this.youtubeService, this.mpdClientService, this.configService));
    // The one YouTube tool that writes: "keep this" over a YouTube stream, imported as its album.
    this.registerTool(new ImportYoutubeHandler(this.youtubeService));
  }

  /**
   * Called by `PlaylogService` once the module is up, so `current_song` can answer from the same
   * snapshot the /vibing-on page shows rather than from the raw MPD tags.
   */
  public setNowPlayingSource(source: NowPlayingSource): void {
    this.nowPlayingSource = source;
  }

  initialiseAgent(apiKey: string, eventEmitter: EventEmitter2) {
    // const chatTitleAgent = new ChatTitleAgent(apiKey, this, this.chatService);
    // this.registerTool(new ChatTitleHandler(chatTitleAgent));

    const discJokeyAgent = new DiscJockeyAgent(
      apiKey,
      this,
      this.profilerService,
      this.fileService,
      this.musicDbService,
      this.opensearchService,
      this.redisCacheService,
      eventEmitter,
    );
    this.discJockeyAgent = discJokeyAgent;
    this.registerTool(new DiscJockeyCreatePlaylistHandler(discJokeyAgent));
    this.registerTool(new DiscJockeyWhatIsPlayingHandler(discJokeyAgent));
    this.registerTool(new DiscJockeyBrowseDatabaseHandler(discJokeyAgent));
    this.registerTool(new DiscJockeyArtistPerformanceHandler(discJokeyAgent));
    this.registerTool(new DiscJockeyTalkAboutMusicHandler(discJokeyAgent));

    const queryDatabaseAgent = new QueryDatabaseAgent(apiKey, this, eventEmitter, this.musicDbService);
    this.registerTool(new QueryDatabaseHandler(queryDatabaseAgent));
  }

  /**
   * The disc jockey built in `initialiseAgent`, for callers that drive it directly rather than
   * through a function call — the now-playing enrichment in `PlaylogService`, for instance.
   * Undefined until `PromptusService` has been constructed.
   */
  public getDiscJockeyAgent(): DiscJockeyAgent | undefined {
    return this.discJockeyAgent;
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

    // The arguments, not just the name: which tool the model reached for is half the story, and the
    // half that explains a wrong answer is what it passed. `promptus chat` is read at this level.
    this.logger.debug(`Tool ${fc.name}(${JSON.stringify(fc.args ?? {})})`);

    return await handler.execute(fc.args, sessionId);
  }
}
