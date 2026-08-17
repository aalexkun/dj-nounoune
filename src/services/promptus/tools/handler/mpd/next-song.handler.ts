import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { Logger } from '@nestjs/common';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { NextMpdRequest } from '../../../../mpd-client/requests/NextMpdRequest';
import { getErrorMessage } from '../../../../../utils/error.utils';
import { describeTrackAfterSkip } from './skip.util';

export class NextSongHandler implements ToolHandler {
  readonly name = MpdToolsDefinition.nextMpdCommand.name;
  private readonly logger = new Logger('NextSongHandler');

  constructor(private mpdClient: MpdClientService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      await this.mpdClient.send(new NextMpdRequest());

      return {
        message: `Skipped to the next song in the queue. ${await describeTrackAfterSkip(this.mpdClient, this.logger)}`,
        name: this.name,
        type: 'string',
      };
    } catch (e) {
      const msg = 'NextMpdRequest failed ' + getErrorMessage(e);
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
        type: 'string',
      };
    }
  }
}
