import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MusicSearchResultsSchema, PlaySource } from '../../../agent/disc-jockey/disc-jockey.agent';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../../../mpd-client/requests/AddMpdRequest';
import { PlayMpdRequest } from '../../../../mpd-client/requests/PlayMpdRequest';
import { AddTagIdMpdRequest } from '../../../../mpd-client/requests/AddTagIdMpdRequest';
import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from '../../../../redis-cache/redis-cache.service';
import { qobuzStreamUri, spotifyStreamUri, youtubeStreamUri } from '../../../../../config/source-uri.util';

interface PlayMusicArgs {
  cacheKey: string;
  clearQueue: boolean;
}

export class PlayMusicHandler implements ToolHandler {
  readonly name: string = MpdToolsDefinition.playMpdCommand.name;
  private readonly logger = new Logger('PlayMusicHandler');


  constructor(private mpdClientService: MpdClientService, private configService: ConfigService, private redisCacheService: RedisCacheService) {}

  isPlayMusicArgs(args: unknown): args is PlayMusicArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;
    return typeof record.cacheKey === 'string' && typeof record.clearQueue === 'boolean';

  }

  private getBestSource(sources: PlaySource[]): PlaySource | undefined {
    if (!sources || sources.length === 0) {
      return undefined;
    }

    const getScore = (source: PlaySource) => {
      let score = 0;
      if (source.technical_info) {
        if (source.technical_info.is_high_res) score += 1000000;
        if (source.technical_info.is_cd_quality) score += 500000;
        if (source.technical_info.sample_rate) score += source.technical_info.sample_rate;
        if (source.technical_info.bitrate) score += source.technical_info.bitrate / 1000;
      }
      // Default source if there is no technical info is qobuz
      if (source.name === 'qobuz') score += 10;
      if (source.name === 'spotify') score += 3;
      // YouTube Premium delivers 256kbps AAC — under Spotify's 320kbps Ogg, over the library's
      // 128/192kbps mp3s. That ordering already falls out of the bitrate term above; this +1 only
      // settles a tie against a local file of the same nominal bitrate, where AAC is the better
      // encoder and the stream is the safer pick.
      if (source.name === 'youtube') score += 1;
      return score;
    };

    const sortedSources = [...sources].sort((a, b) => getScore(b) - getScore(a));
    return sortedSources[0];
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isPlayMusicArgs(args)) {
      throw new Error(`Invalid arguments provided to play_music. Expected an array of songs with sourceIds.`);
    }


    const songsQueued: string[] = [];

    if(args.clearQueue){
      try {
        await this.mpdClientService.send(new ClearMpdRequest());
      } catch (e) {
        this.logger.error(e);
        this.logger.error('Failed to clear MPD playlist');
      }
    }

    const songs = await this.redisCacheService.get(args.cacheKey, MusicSearchResultsSchema);

    if(!songs){
      throw new Error(`No songs found for cacheKey: ${args.cacheKey}`);
    }

    for (const song of songs) {
      if (song.source === undefined) {
        this.logger.error(`SourceId is undefined for song: ${JSON.stringify(song)}`);
        continue;
      }

      // Get best source
      const bestSource = this.getBestSource(song.source);

      if(!bestSource) {
        this.logger.error(`No source found for song: ${JSON.stringify(song)}`);
        continue;
      }

      this.logger.debug(`Selected best source from ${song.source.length} option(s) for song: ${song.title || 'Unknown'}`);


      let uri: string;
      if (bestSource.name === 'qobuz') {
        uri = qobuzStreamUri(this.configService, bestSource.sourceId);
      } else if (bestSource.name === 'spotify') {
        uri = spotifyStreamUri(this.configService, bestSource.sourceId);
      } else if (bestSource.name === 'youtube') {
        uri = youtubeStreamUri(this.configService, bestSource.sourceId);
      } else {
        uri = bestSource.sourceId;
      }

      try {
        const addResponse = await this.mpdClientService.send(new AddMpdRequest(uri));
        const songId = addResponse.songId;
        if (songId) {
          if (song.artist) {
            await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Artist', song.artist));
          }
          if (song.title) {
            await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Title', song.title));
          }
          if (song.album) {
            await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Album', song.album));
          }
        }
        songsQueued.push(`${song.artist} - ${song.album} - ${song.title}`);
      } catch (e) {
        this.logger.debug(`Could not added to playlist: ${song.title} - ${song.artist} - ${song.album}`);
      }
    }

    try {
      await this.mpdClientService.send(new PlayMpdRequest());
      this.logger.log('Playback started.');
    } catch (e) {
      this.logger.error(e);
      this.logger.error('Failed to start playback');
    }

    const markdownList = songsQueued.map((item) => `- ${item}`).join('\n');

    return {
      message: `Songs queued successfully:\n\n${markdownList}`,
      name: 'play_music',
      type: 'string',
    };
  }
}
