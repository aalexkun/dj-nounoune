import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../services/auth/user.service';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * Lifts a block.
 *
 * The allow-list still applies afterwards: an account removed from `AUTH_ALLOWED_EMAILS` stays
 * unable to sign in however unblocked it is.
 */
@SubCommand({
  name: 'unblock',
  arguments: '<email>',
  description: 'Lift a block; the allow-list still decides whether they may sign in',
})
@Injectable()
export class AuthUnblockSubCommand extends CommandRunner {
  private readonly logger = new Logger(AuthUnblockSubCommand.name);

  constructor(private readonly users: UserService) {
    super();
  }

  async run(inputs: string[]): Promise<void> {
    const email = inputs[0]?.trim();
    if (!email) {
      this.logger.error('Give the address, e.g. auth unblock someone@example.com');
      process.exitCode = 1;
      return;
    }

    try {
      const user = await this.users.unblock(email);
      if (!user) {
        this.logger.error(`No account for ${email}.`);
        process.exitCode = 1;
        return;
      }

      const allowed = this.users.isAllowed(user.email);
      this.logger.log(
        allowed
          ? `${user.email} is active again and on the allow-list.`
          : `${user.email} is active again, but not on AUTH_ALLOWED_EMAILS — they still cannot sign in.`,
      );
    } catch (error: unknown) {
      this.logger.error(`Could not unblock ${email}: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}
