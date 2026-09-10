import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { YoutubeService } from '../../services/youtube/youtube.service';
import { getErrorMessage } from '../../utils/error.utils';
import { releaseStdin } from '../../utils/cli.utils';

@SubCommand({
  name: 'auth',
  description: 'Authenticate with YouTube via Google OAuth (only needed for liked videos and private playlists)',
})
@Injectable()
export class YoutubeAuthSubCommand extends CommandRunner {
  private readonly logger = new Logger(YoutubeAuthSubCommand.name);

  constructor(private readonly youtubeService: YoutubeService) {
    super();
  }

  async run(): Promise<void> {
    this.logger.log('Starting YouTube Authentication...');
    this.logger.log('Note: searching and playing need only YOUTUBE_API_KEY. This flow is for the signed-in account only.');

    try {
      this.youtubeService.auth.getAuthorizeUrl();
    } catch (error) {
      // Returning rather than exiting, for the same reason the prompt below does: an explicit
      // process.exit tears the loop down while the MPD socket and the Mongoose connection are
      // still open, which is what libuv asserts on. Nothing is holding stdin yet at this point.
      this.logger.error(getErrorMessage(error));
      process.exitCode = 1;
      return;
    }

    const rl = readline.createInterface({ input, output });

    try {
      const code = await rl.question('Enter the code from the redirect URL: ');

      if (!code) {
        this.logger.error('Error: No code entered.');
        return;
      }

      await this.youtubeService.auth.handleAuthorizationCodeGrant(code.trim());
    } catch (error) {
      this.logger.error(`Error getting tokens: ${getErrorMessage(error)}`);
    } finally {
      rl.close();
      releaseStdin();
    }
  }
}
