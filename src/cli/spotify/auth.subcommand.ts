import { SubCommand, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { SpotifyService } from '../../services/spotify/spotify.service';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

@SubCommand({
  name: 'auth',
  description: 'Authenticate with Spotify',
})
@Injectable()
export class SpotifyAuthSubCommand extends CommandRunner {
  private readonly logger = new Logger(SpotifyAuthSubCommand.name);

  constructor(private readonly spotifyService: SpotifyService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    this.logger.log('Starting Spotify Authentication...');
    const scopes = ['user-read-private', 'user-read-email', 'user-library-read', 'playlist-modify-public', 'playlist-modify-private'];
    
    // We get the authorize URL and the auth utility logs the instructions
    this.spotifyService.auth.getAuthorizeUrl(scopes);
    
    // Wait for the user to input the code
    const rl = readline.createInterface({ input, output });

    try {
      const code = await rl.question('Enter the code from the redirect URL: ');

      if (!code) {
        this.logger.error('Error: No code entered.');
        return;
      }

      await this.spotifyService.auth.handleAuthorizationCodeGrant(code);
    } catch (err) {
      this.logger.error('Error getting tokens: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      rl.close();
      process.exit(0);
    }
  }
}
