import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { Logger } from '@nestjs/common';
import { MpdClientService } from '../../../../../mpd-client/mpd-client.service';
import { StopMpdRequest } from '../../../../../mpd-client/requests/StopMpdRequest';

export class StopPlaybackHandler implements ToolHandler {
  readonly name = 'stop_playback';
  private readonly logger = new Logger('StopPlaybackHandler');

  constructor(private mpdClient: MpdClientService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      await this.mpdClient.send(new StopMpdRequest());
      return {
        message: 'Playback stopped.',
        name: this.name,
      };
    } catch (e) {
      const msg = 'StopMpdRequest failled ' + e.message;
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
      };
    }
  }
}
