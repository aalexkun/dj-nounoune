import { SubCommand, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { QobuzService } from '../../services/qobuz/qobuz.service';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

@SubCommand({
  name: 'auth',
  description: 'Authenticate with Qobuz via OAuth',
})
@Injectable()
export class QobuzAuthSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzAuthSubCommand.name);

  constructor(private readonly qobuzService: QobuzService) {
    super();
  }

  async run(): Promise<void> {
    this.logger.log('Starting Qobuz Authentication...');

    // Generate the authorize URL and the auth utility logs the instructions
    await this.qobuzService.auth.getAuthorizeUrl();

    // Wait for the user to input the code
    const rl = readline.createInterface({ input, output });

    try {
      const code = await rl.question('Enter the code_autorisation from the redirect URL: ');

      if (!code) {
        this.logger.error('Error: No code entered.');
        return;
      }

      await this.qobuzService.auth.handleAuthorizationCodeGrant(code);
    } catch (err) {
      this.logger.error('Error getting tokens: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      rl.close();
      process.exit(0);
    }
  }
}
