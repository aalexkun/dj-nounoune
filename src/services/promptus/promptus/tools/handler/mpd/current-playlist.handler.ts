import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { Logger } from '@nestjs/common';
import { MpdClientService } from '../../../../../mpd-client/mpd-client.service';
import { PlaylistMpdRequest } from '../../../../../mpd-client/requests/PlaylistMpdRequest';

export class CurrentPlaylistHandler implements ToolHandler {
  readonly name = 'current_playlist';

  private readonly logger = new Logger('CurrentPlaylistHandler');

  constructor(private mpdClientService: MpdClientService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      const result = await this.mpdClientService.send(new PlaylistMpdRequest());
      return {
        message: JSON.stringify(result.tracks) || 'No playlist is currently playing.',
        name: this.name,
      };
    } catch (e) {
      const msg = 'Getting playlist function failed. ' + e.message;
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
      };
    }
  }
}
