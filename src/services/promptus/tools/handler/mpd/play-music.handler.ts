import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MusicSearchResult } from '../../../agent/disc-jockey/disc-jockey.agent';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../../../mpd-client/requests/AddMpdRequest';
import { PlayMpdRequest } from '../../../../mpd-client/requests/PlayMpdRequest';
import { ConfigService } from '@nestjs/config';

interface PlayMusicArgs {
  songs: Partial<MusicSearchResult>[];
}

export class PlayMusicHandler implements ToolHandler {
  readonly name: string = MpdToolsDefinition.playMpdCommand.name;
  private readonly logger = new Logger('PlayMusicHandler');


  constructor(private mpdClientService: MpdClientService, private configService: ConfigService) {}

  isPlayMusicArgs(args: unknown): args is PlayMusicArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;

    if (!Array.isArray(record.songs)) {
      return false;
    }

    return record.songs.every((song: unknown) => {
      if (!song || typeof song !== 'object') return false;
      const songRecord = song as Record<string, unknown>;

      if (!Array.isArray(songRecord.source)) return false;

      return songRecord.source.every((src: unknown) => {
        if (!src || typeof src !== 'object') return false;
        const srcRecord = src as Record<string, unknown>;
        return typeof srcRecord.name === 'string' && typeof srcRecord.sourceId === 'string';
      });
    });
  }

  private getQobuzProxyUrl(): string {

    const qobuzProxyUrl = this.configService.get<string>('QOBUZ_STREAM_PROXY_SERVER');
    if(!qobuzProxyUrl){
      throw new Error('QOBUZ_STREAM_PROXY_SERVER is not defined in the environment variables');
    }
    return `${qobuzProxyUrl}/qobuz/track/version/1/trackId/`;
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isPlayMusicArgs(args)) {
      throw new Error(`Invalid arguments provided to play_music. Expected an array of songs with sourceIds.`);
    }
    const songs = args.songs;
    const songsQueued: string[] = [];

    try {
      await this.mpdClientService.send(new ClearMpdRequest());
    } catch (e) {
      this.logger.error(e);
      this.logger.error('Failed to clear MPD playlist');
    }

    for (const song of songs) {
      if (song.source === undefined) {
        this.logger.error(`SourceId is undefined for song: ${JSON.stringify(song)}`);
        continue;
      }

      // Get best source
      const bestSource =
        song.source.find((source) => source.name === 'qobuz') ||
        song.source.find((source) => source.name === 'file');

      if(!bestSource) {
        this.logger.error(`No source found for song: ${JSON.stringify(song)}`);
        continue;
      }

      const uri = bestSource.name === 'qobuz' ? `${this.getQobuzProxyUrl()}${bestSource.sourceId}` : bestSource.sourceId;

      try {
        await this.mpdClientService.send(new AddMpdRequest(uri));
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
