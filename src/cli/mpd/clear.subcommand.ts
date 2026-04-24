import { SubCommand, CommandRunner } from 'nest-commander';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../services/mpd-client/requests/ClearMpdRequest';
import { Injectable, Logger } from '@nestjs/common';

@SubCommand({
  name: 'clear',
  description: 'Clear the current playlist',
})
@Injectable()
export class ClearMpdSubCommand extends CommandRunner {
  private readonly logger = new Logger(ClearMpdSubCommand.name);

  constructor(private readonly mpdClient: MpdClientService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    try {
      this.logger.log('Clearing playlist...');
      const response = await this.mpdClient.send(new ClearMpdRequest());
      this.logger.log(`Response: ${response.rawResponse.trim()}`);
    } catch (error: any) {
      this.logger.error(`Failed to clear playlist: ${error.message}`);
    }
  }
}
