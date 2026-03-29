import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MusicSearchResult } from '../../../agent/disc-jockey/disc-jockey.agent';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../../../mpd-client/requests/AddMpdRequest';
import { PlayMpdRequest } from '../../../../mpd-client/requests/PlayMpdRequest';

interface PlayMusicArgs {
  songs: Partial<MusicSearchResult>[];
}

export class PlayMusicHandler implements ToolHandler {
  readonly name: string = MpdToolsDefinition.playMpdCommand.name;

  private mpdClientService: MpdClientService;
  private readonly logger = new Logger('PlayMusicHandler');

  constructor(mpdClientService: MpdClientService) {
    this.mpdClientService = mpdClientService;
  }

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
      return typeof songRecord.sourceId === 'string';
    });
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
      if (song.sourceId === undefined) {
        this.logger.error(`SourceId is undefined for song: ${JSON.stringify(song)}`);
        continue;
      }

      try {
        await this.mpdClientService.send(new AddMpdRequest(song.sourceId));
        songsQueued.push(`${song.artist} - ${song.album} - ${song.title}`);
      } catch (e) {
        this.logger.debug(`Could not added to playlist: ${song.title} - ${song.artist} - ${song.album} - ${song.sourceId}`);
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
    };
  }
}
