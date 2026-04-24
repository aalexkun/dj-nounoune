import { SubCommand, CommandRunner, Option } from 'nest-commander';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { ShuffleMpdRequest } from '../../services/mpd-client/requests/ShuffleMpdRequest';
import { Injectable, Logger } from '@nestjs/common';

@SubCommand({
  name: 'shuffle',
  description: 'Shuffle the current playlist',
})
@Injectable()
export class ShuffleMpdSubCommand extends CommandRunner {
  private readonly logger = new Logger(ShuffleMpdSubCommand.name);

  constructor(private readonly mpdClient: MpdClientService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    try {
      // inputs can be used for range if needed, but for now specific options or just simple shuffle
      const range = inputs[0];
      this.logger.log(range ? `Shuffling playlist range ${range}...` : 'Shuffling playlist...');

      const response = await this.mpdClient.send(new ShuffleMpdRequest(range));
      this.logger.log(`Response: ${response.rawResponse.trim()}`);
    } catch (error: any) {
      this.logger.error(`Failed to shuffle playlist: ${error.message}`);
    }
  }
}
