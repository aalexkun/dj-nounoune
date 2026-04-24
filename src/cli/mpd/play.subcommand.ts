import { SubCommand, CommandRunner } from 'nest-commander';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { PlayMpdRequest } from '../../services/mpd-client/requests/PlayMpdRequest';
import { Injectable, Logger } from '@nestjs/common';

@SubCommand({
  name: 'play',
  description: 'Start playback',
  argsDescription: {
    pos: 'Optional song position/id to play',
  },
})
@Injectable()
export class PlayMpdSubCommand extends CommandRunner {
  private readonly logger = new Logger(PlayMpdSubCommand.name);

  constructor(private mpdClient: MpdClientService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    const pos = inputs[0] ? parseInt(inputs[0], 10) : undefined;

    this.logger.log(`Sending Play command${pos !== undefined ? ' for pos ' + pos : ''}...`);
    // Give some time for initial connection
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      await this.mpdClient.send(new PlayMpdRequest(pos));
      this.logger.log('Playback started.');
    } catch (error: any) {
      this.logger.error(`Failed to play: ${error.message}`);
    }
  }
}
