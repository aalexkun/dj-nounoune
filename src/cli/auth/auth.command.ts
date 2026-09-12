import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { AuthUsersSubCommand } from './users.subcommand';
import { AuthBlockSubCommand } from './block.subcommand';
import { AuthUnblockSubCommand } from './unblock.subcommand';
import { AuthRevokeSubCommand } from './revoke.subcommand';
import { AuthClaimSubCommand } from './claim.subcommand';
import { AuthSessionSubCommand } from './session.subcommand';
import { AuthImportSessionsSubCommand } from './import-sessions.subcommand';

/**
 * Account administration: there is no admin UI and there is not going to be one.
 *
 * Who may sign in is `AUTH_ALLOWED_EMAILS` in the environment; everything that is per-person and
 * durable — blocking, revoking, re-pointing old conversations, minting a token for curl — lives
 * here, against the same Mongo and the same Redis the server uses.
 */
@Command({
  name: 'auth',
  description: 'Accounts and sessions: who has signed in, who is blocked, and a bearer token for curl',
  subCommands: [
    AuthUsersSubCommand,
    AuthBlockSubCommand,
    AuthUnblockSubCommand,
    AuthRevokeSubCommand,
    AuthClaimSubCommand,
    AuthSessionSubCommand,
    AuthImportSessionsSubCommand,
    // One per line on purpose: the next subcommand lands on its own line, not in a reflowed list.
  ],
})
@Injectable()
export class AuthCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: users, block, unblock, revoke, claim, session, import-sessions');
    return Promise.resolve();
  }
}
