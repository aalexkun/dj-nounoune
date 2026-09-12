import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../services/auth/user.service';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * Bars an account, whatever the allow-list says.
 *
 * It takes effect within a minute on live sessions — that is the `User` read cache — and
 * immediately on the next sign-in. Pair it with `auth revoke` to cut the open sessions now.
 */
@SubCommand({
  name: 'block',
  arguments: '<email>',
  description: 'Block an account: no sign-in, and every live session is refused within a minute',
})
@Injectable()
export class AuthBlockSubCommand extends CommandRunner {
  private readonly logger = new Logger(AuthBlockSubCommand.name);

  constructor(private readonly users: UserService) {
    super();
  }

  async run(inputs: string[]): Promise<void> {
    const email = inputs[0]?.trim();
    if (!email) {
      this.logger.error('Give the address, e.g. auth block someone@example.com');
      process.exitCode = 1;
      return;
    }

    try {
      const user = await this.users.block(email);
      if (!user) {
        this.logger.error(`No account for ${email} — they have never signed in, so there is nothing to block.`);
        process.exitCode = 1;
        return;
      }

      this.logger.log(`${user.email} is now blocked. Run "auth revoke ${user.email}" to drop their open sessions at once.`);
    } catch (error: unknown) {
      this.logger.error(`Could not block ${email}: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}
