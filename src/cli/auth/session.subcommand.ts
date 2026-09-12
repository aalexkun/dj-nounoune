import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { AuthSessionService } from '../../services/auth/auth-session.service';
import { UserService } from '../../services/auth/user.service';
import { getErrorMessage } from '../../utils/error.utils';

interface SessionOptions {
  email?: string;
  ttl?: number;
}

/** `30m`, `2h`, `7d`, or a bare number read as seconds. */
const TTL_PATTERN = /^(\d+)\s*([smhd]?)$/i;

const TTL_MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
};

/**
 * Mints a bearer token for one account, from the command line.
 *
 * This is what replaces the shared key for debugging: a curl against `/chatroom` now carries a real
 * session belonging to a real person, so what it sees is exactly what that person's phone sees.
 * `--ttl` is there because a debugging token has no business living for ninety days.
 *
 * Redis connects lazily, so this works from the CLI even though the boot probe is skipped under
 * `IS_CLI` — but it does need a reachable Redis, since that is where the session lives.
 */
@SubCommand({
  name: 'session',
  description: 'Mint a bearer token for an account, for curl. Replaces the shared key for debugging.',
})
@Injectable()
export class AuthSessionSubCommand extends CommandRunner {
  private readonly logger = new Logger(AuthSessionSubCommand.name);

  constructor(
    private readonly users: UserService,
    private readonly sessions: AuthSessionService,
  ) {
    super();
  }

  @Option({
    flags: '--email <email>',
    description: 'The account to mint for; it must have signed in at least once',
  })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '--ttl <duration>',
    description: 'How long it lives: 30m, 2h, 7d, or seconds. Defaults to AUTH_SESSION_TTL_DAYS.',
  })
  parseTtl(value: string): number {
    const seconds = parseDuration(value);
    if (seconds === null) {
      throw new Error(`Could not read "${value}" as a duration. Use 30m, 2h, 7d, or a number of seconds.`);
    }
    return seconds;
  }

  async run(_inputs: string[], options: SessionOptions): Promise<void> {
    const email = options.email?.trim();
    if (!email) {
      this.logger.error('Give the account: auth session --email someone@example.com [--ttl 2h]');
      process.exitCode = 1;
      return;
    }

    try {
      const user = await this.users.findByEmail(email);
      if (!user) {
        this.logger.error(`No account for ${email} — they have to sign in on the phone once before a session can be minted.`);
        process.exitCode = 1;
        return;
      }

      // A blocked account is refused by `mint` itself, so the rule lives in one place.
      const minted = await this.sessions.mint(user, { deviceId: 'cli', deviceName: 'cli' }, options.ttl);

      console.log('');
      console.log(`Account:   ${user.email} (${minted.user.id})`);
      console.log(`Expires:   ${new Date(minted.expiresAt).toISOString()}`);
      console.log(`Token:     ${minted.token}`);
      console.log('');
      console.log(`  curl -s http://localhost:3000/auth/me -H "Authorization: Bearer ${minted.token}"`);
      console.log('');
    } catch (error: unknown) {
      this.logger.error(`Could not mint a session for ${email}: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}

/** @returns The duration in seconds, or `null` when the text is not one */
function parseDuration(value: string): number | null {
  const match = TTL_PATTERN.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return amount * (TTL_MULTIPLIERS[match[2].toLowerCase()] ?? 1);
}
