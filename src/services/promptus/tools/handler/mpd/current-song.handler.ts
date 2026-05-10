import { FunctionCallResult, ToolHandler } from '../../tool.type';

import { Logger } from '@nestjs/common';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { CurrentSongMpdRequest } from '../../../../mpd-client/requests/CurrentSongMpdRequest';
import { CurrentSongInfo } from '../../../../mpd-client/responses/CurrentSongMpdResponse';
import { MusicDbService } from '../../../../music-db/music-db.service';

export class CurrentSongHandler implements ToolHandler {
  readonly name = MpdToolsDefinition.currentMpdCommand.name;
  private readonly logger = new Logger('CurrentSongHandler');

  constructor(private mpdClientService: MpdClientService, private musicDbService: MusicDbService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      let song: CurrentSongInfo | null = null;
      const result = await this.mpdClientService.send(new CurrentSongMpdRequest());

      const qobuzTrack = result?.song?.file?.match(/qobuz\/track\/version\/1\/trackId\/(\d+)/);
      const qobuzId = qobuzTrack ? qobuzTrack[1] : null;
      if (qobuzId) {
        const qobuzSong = await this.musicDbService.getSongByQobuzId(qobuzId);
        if(qobuzSong){
          song = {
            ...qobuzSong,
            file: qobuzSong.title};
        }

      } else if (result.song) {
        song = result.song;
      } else {
        song = {
          file: 'No song is currently playing.',
        };
      }

      return {
        message: JSON.stringify(song) || 'No song is currently playing.',
        name: this.name,
        type: 'string',
      };
    } catch (e) {
      const msg = 'Function call failed with error: ' + e.message;
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
        type: 'string',
      };
    }
  }
}
