import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../services/auth/user.service';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * Signs one person out of every device at once.
 *
 * One `$inc` on `sessionEpoch`: every record in Redis carries the epoch it was minted under and is
 * refused below the current one, so there is no set of sessions to enumerate and nothing to delete.
 * The phone finds out on its next request and drops to the login screen.
 */
@SubCommand({
  name: 'revoke',
  arguments: '<email>',
  description: 'Sign an account out everywhere by bumping its session epoch',
})
@Injectable()
export class AuthRevokeSubCommand extends CommandRunner {
  private readonly logger = new Logger(AuthRevokeSubCommand.name);

  constructor(private readonly users: UserService) {
    super();
  }

  async run(inputs: string[]): Promise<void> {
    const email = inputs[0]?.trim();
    if (!email) {
      this.logger.error('Give the address, e.g. auth revoke someone@example.com');
      process.exitCode = 1;
      return;
    }

    try {
      const user = await this.users.bumpEpoch(email);
      if (!user) {
        this.logger.error(`No account for ${email}.`);
        process.exitCode = 1;
        return;
      }

      this.logger.log(`Every session of ${user.email} is revoked; the session epoch is now ${user.sessionEpoch}.`);
    } catch (error: unknown) {
      this.logger.error(`Could not revoke the sessions of ${email}: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}
