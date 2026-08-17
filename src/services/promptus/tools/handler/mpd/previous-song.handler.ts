import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { Logger } from '@nestjs/common';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { PreviousMpdRequest } from '../../../../mpd-client/requests/PreviousMpdRequest';
import { getErrorMessage } from '../../../../../utils/error.utils';
import { describeTrackAfterSkip } from './skip.util';

export class PreviousSongHandler implements ToolHandler {
  readonly name = MpdToolsDefinition.previousMpdCommand.name;
  private readonly logger = new Logger('PreviousSongHandler');

  constructor(private mpdClient: MpdClientService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      await this.mpdClient.send(new PreviousMpdRequest());

      return {
        message: `Went back to the previous song in the queue. ${await describeTrackAfterSkip(this.mpdClient, this.logger)}`,
        name: this.name,
        type: 'string',
      };
    } catch (e) {
      const msg = 'PreviousMpdRequest failed ' + getErrorMessage(e);
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
        type: 'string',
      };
    }
  }
}
