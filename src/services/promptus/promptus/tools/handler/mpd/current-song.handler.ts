import { FunctionCallResult, ToolHandler } from '../../tool.type';

import { Logger } from '@nestjs/common';
import { MpdClientService } from '../../../../../mpd-client/mpd-client.service';
import { CurrentSongMpdRequest } from '../../../../../mpd-client/requests/CurrentSongMpdRequest';

export class CurrentSongHandler implements ToolHandler {
  readonly name = 'current_song';
  private readonly mpdClientService: MpdClientService;
  private readonly logger = new Logger('CurrentSongHandler');

  constructor(mpdClientService: MpdClientService) {
    this.mpdClientService = mpdClientService;
  }

  async execute(): Promise<FunctionCallResult> {
    try {
      const result = await this.mpdClientService.send(new CurrentSongMpdRequest());
      return {
        message: JSON.stringify(result.song) || 'No song is currently playing.',
        name: this.name,
      };
    } catch (e) {
      const msg = 'Function call failed with error: ' + e.message;
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
      };
    }
  }
}
