import { Injectable, Logger } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { CredentialStoreService, ProviderName } from '../../services/credential-store/credential-store.service';
import { SpotifySessionSchema } from '../../services/spotify/spotify.service';
import { QobuzSessionSchema } from '../../services/qobuz/qobuz.service';
import { YoutubeSessionSchema } from '../../services/youtube/youtube.interfaces';
import { getErrorMessage } from '../../utils/error.utils';

interface ImportSessionsOptions {
  delete?: boolean;
}

/** One dotfile to move, and the schema that says what it should contain. */
interface LegacySessionFile {
  provider: ProviderName;
  fileName: string;
  schema: z.ZodType<unknown>;
}

/**
 * The three dotfiles, in the order they are reported. Each schema is the provider service's own, so
 * a file that would not have loaded before is not quietly blessed on the way into Mongo.
 */
const LEGACY_SESSION_FILES: LegacySessionFile[] = [
  { provider: 'spotify', fileName: '.spotify-session.json', schema: SpotifySessionSchema },
  { provider: 'qobuz', fileName: '.qobuz-session.json', schema: QobuzSessionSchema },
  { provider: 'youtube', fileName: '.youtube-session.json', schema: YoutubeSessionSchema },
];

/**
 * Moves `.spotify-session.json`, `.qobuz-session.json` and `.youtube-session.json` into the
 * encrypted `provider_credentials` collection.
 *
 * A one-shot migration, run once per box. It is idempotent — importing twice writes the same
 * session twice — and it is safe to run with the server up, since every provider service reads the
 * store on boot and re-reads it when a call comes back 401.
 *
 * `--delete` removes each dotfile, and only ever **after** that provider's save has resolved: a
 * plaintext token left on disk is a smaller problem than a token that exists nowhere.
 */
@SubCommand({
  name: 'import-sessions',
  description: 'Move the three .x-session.json dotfiles into the encrypted provider_credentials collection',
})
@Injectable()
export class AuthImportSessionsSubCommand extends CommandRunner {
  private readonly logger = new Logger(AuthImportSessionsSubCommand.name);

  constructor(private readonly credentialStore: CredentialStoreService) {
    super();
  }

  @Option({
    flags: '--delete',
    description: 'Delete each dotfile once its session has been stored',
  })
  parseDelete(): boolean {
    return true;
  }

  async run(_inputs: string[], options: ImportSessionsOptions): Promise<void> {
    if (!this.credentialStore.isEnabled()) {
      this.logger.error('CREDENTIAL_ENCRYPTION_KEY is missing or invalid, so nothing can be stored. Generate one with `openssl rand -base64 32`.');
      process.exitCode = 1;
      return;
    }

    let imported = 0;
    let failed = 0;

    for (const entry of LEGACY_SESSION_FILES) {
      const filePath = path.join(process.cwd(), entry.fileName);

      if (!fs.existsSync(filePath)) {
        this.logger.log(`${entry.fileName}: not present, nothing to import.`);
        continue;
      }

      try {
        const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const parsed = entry.schema.safeParse(raw);

        if (!parsed.success) {
          this.logger.error(`${entry.fileName}: does not match the expected ${entry.provider} session shape - skipped, and left on disk.`);
          failed += 1;
          continue;
        }

        await this.credentialStore.save(entry.provider, parsed.data, 'cli');
        imported += 1;
        this.logger.log(`${entry.fileName}: stored as the ${entry.provider} session, encrypted.`);

        if (options.delete) {
          fs.unlinkSync(filePath);
          this.logger.log(`${entry.fileName}: deleted.`);
        }
      } catch (error) {
        this.logger.error(`${entry.fileName}: ${getErrorMessage(error)} - skipped, and left on disk.`);
        failed += 1;
      }
    }

    this.logger.log(`Imported ${imported} session(s)${failed ? `, ${failed} failed` : ''}.`);

    if (!options.delete && imported > 0) {
      this.logger.log('The dotfiles were left in place. Re-run with --delete once the providers have been verified.');
    }

    if (failed) {
      process.exitCode = 1;
    }
  }
}
