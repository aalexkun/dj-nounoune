import { SubCommand, CommandRunner } from 'nest-commander';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { PlaylistMpdRequest } from '../../services/mpd-client/requests/PlaylistMpdRequest';
import { Injectable, Logger } from '@nestjs/common';

@SubCommand({
  name: 'playlist',
  description: 'Show current playlist',
})
@Injectable()
export class PlaylistMpdSubCommand extends CommandRunner {
  private readonly logger = new Logger(PlaylistMpdSubCommand.name);

  constructor(private readonly mpdClient: MpdClientService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    try {
      this.logger.log('Fetching playlist...');
      const response = await this.mpdClient.send(new PlaylistMpdRequest());

      this.logger.log(`Found ${response.tracks.length} tracks in playlist.`);
      response.tracks.forEach((track, index) => {
        this.logger.log(`${index + 1}: ${track.Title || track.file}`);
      });
    } catch (error: any) {
      this.logger.error(`Failed to get playlist: ${error.message}`);
    }
  }
}
