import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { UserService } from '../../services/auth/user.service';
import { ChatService } from '../../services/chat/chat.service';
import { getErrorMessage } from '../../utils/error.utils';

/** Column widths of the table below, wide enough for an email and a phone-sized name. */
const COLUMNS: { header: string; width: number }[] = [
  { header: 'EMAIL', width: 38 },
  { header: 'STATUS', width: 8 },
  { header: 'EPOCH', width: 6 },
  { header: 'LAST LOGIN', width: 20 },
  { header: 'CHATS', width: 6 },
];

/**
 * Everybody who has ever signed in, with what the other subcommands act on.
 *
 * The chat count is here because it is the number you want before running `auth claim` or deleting
 * anything. It comes from `ChatService.countPerOwner`, the same reading of `Chat.userId` every
 * other consumer uses.
 */
@SubCommand({
  name: 'users',
  description: 'List every account: email, status, session epoch, last login and conversation count',
})
@Injectable()
export class AuthUsersSubCommand extends CommandRunner {
  private readonly logger = new Logger(AuthUsersSubCommand.name);

  constructor(
    private readonly users: UserService,
    private readonly chats: ChatService,
  ) {
    super();
  }

  async run(): Promise<void> {
    try {
      const accounts = await this.users.list();
      const allowed = this.users.allowList();

      console.log(`\nAllow-list (AUTH_ALLOWED_EMAILS): ${allowed.length > 0 ? allowed.join(', ') : '(empty — nobody can sign in)'}`);

      if (accounts.length === 0) {
        console.log('\nNo account has signed in yet.\n');
        return;
      }

      const counts = await this.chats.countPerOwner();

      console.log('');
      console.log(COLUMNS.map((column) => column.header.padEnd(column.width)).join(''));
      console.log(COLUMNS.map((column) => '-'.repeat(column.width - 1).padEnd(column.width)).join(''));

      for (const account of accounts) {
        const id = account._id.toString();
        const cells = [
          account.email,
          account.status,
          String(account.sessionEpoch),
          account.lastLoginAt ? account.lastLoginAt.toISOString().slice(0, 19).replace('T', ' ') : 'never',
          String(counts.get(id) ?? 0),
        ];

        console.log(cells.map((cell, index) => cell.padEnd(COLUMNS[index].width)).join(''));
      }

      console.log('');
    } catch (error: unknown) {
      this.logger.error(`Could not list the accounts: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}
