import { SubCommand, CommandRunner } from 'nest-commander';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { AddMpdRequest } from '../../services/mpd-client/requests/AddMpdRequest';
import { Injectable, Logger } from '@nestjs/common';

@SubCommand({
  name: 'add',
  description: 'Add a song to the Play Queue',
  argsDescription: {
    uri: 'The URI of the song/file to add',
  },
})
@Injectable()
export class AddMpdSubCommand extends CommandRunner {
  private readonly logger = new Logger(AddMpdSubCommand.name);

  constructor(private mpdClient: MpdClientService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    const uri = inputs[0];
    if (!uri) {
      this.logger.error('URI argument is required');
      return;
    }

    this.logger.log(`Adding ${uri} to playlist...`);
    // Give some time for initial connection if needed
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      await this.mpdClient.send(new AddMpdRequest(uri));
      this.logger.log('Successfully added to playlist.');
    } catch (error: any) {
      this.logger.error(`Failed to add: ${error.message}`);
    }
  }
}
