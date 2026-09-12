import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../services/auth/user.service';
import { ChatService } from '../../services/chat/chat.service';
import { getErrorMessage } from '../../utils/error.utils';

interface ClaimOptions {
  from?: string;
  email?: string;
  dryRun?: boolean;
}

/**
 * Moves the conversations written under a pre-sign-in user id onto a real account.
 *
 * `Chat.userId` used to be whatever the phone asserted (`Alexis-le-Trotteur`); it is now a `User`
 * document's `_id`. This is the one-way migration between the two, and it is deliberately manual:
 * the mapping from an asserted string to a person only exists in somebody's head.
 *
 * The account must already exist, which means the person must have signed in at least once — that
 * is the only proof the server has that the two identities are the same human. The move itself is
 * `ChatService.reassignOwner`; this command only decides whether to run it and reports the counts.
 */
@SubCommand({
  name: 'claim',
  description: 'Re-point every chat written under a legacy user id onto a signed-in account',
})
@Injectable()
export class AuthClaimSubCommand extends CommandRunner {
  private readonly logger = new Logger(AuthClaimSubCommand.name);

  constructor(
    private readonly users: UserService,
    private readonly chats: ChatService,
  ) {
    super();
  }

  @Option({
    flags: '--from <legacyUserId>',
    description: 'The userId the chats currently carry, e.g. Alexis-le-Trotteur',
  })
  parseFrom(value: string): string {
    return value;
  }

  @Option({
    flags: '--email <email>',
    description: 'The account to hand them to; it must have signed in at least once',
  })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '--dry-run',
    description: 'Count what would move and change nothing',
  })
  parseDryRun(): boolean {
    return true;
  }

  async run(_inputs: string[], options: ClaimOptions): Promise<void> {
    const from = options.from?.trim();
    const email = options.email?.trim();

    if (!from || !email) {
      this.logger.error('Both are required: auth claim --from <legacyUserId> --email <email> [--dry-run]');
      process.exitCode = 1;
      return;
    }

    try {
      const user = await this.users.findByEmail(email);
      if (!user) {
        this.logger.error(`No account for ${email} — they have to sign in on the phone once before their chats can be handed over.`);
        process.exitCode = 1;
        return;
      }

      const to = user._id.toString();
      if (to === from) {
        this.logger.log(`Nothing to do: the chats already belong to ${user.email}.`);
        return;
      }

      const [pending, existing] = await Promise.all([this.chats.countOwned(from), this.chats.countOwned(to)]);

      if (pending === 0) {
        this.logger.log(`No chat carries userId "${from}". ${user.email} already owns ${existing}.`);
        return;
      }

      if (options.dryRun) {
        this.logger.log(`[DryRun] Would move ${pending} chat(s) from "${from}" to ${user.email} (${to}), who already owns ${existing}.`);
        return;
      }

      const moved = await this.chats.reassignOwner(from, to);
      this.logger.log(`Moved ${moved} chat(s) from "${from}" to ${user.email} (${to}); they now own ${existing + moved}.`);
    } catch (error: unknown) {
      this.logger.error(`Could not claim the chats of "${from}": ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}
