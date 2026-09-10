import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixtureFiles } from '../../services/chat/protocol/fixtures';
import { getErrorMessage } from '../../utils/error.utils';

interface FixturesOptions {
  out?: string;
}

/** Where both repos look for the contract. Relative to the repo root, not to `dist`. */
const DEFAULT_OUT = 'contract/fixtures';

/**
 * Writes one golden JSON sample per payload type.
 *
 * This is the seam between the two repos: the schemas here are the source of truth, and the
 * Android test suite decodes exactly these files. Run it in CI — a fixture set nobody regenerates
 * lets the Kotlin test pass against a contract that has already moved.
 */
@SubCommand({
  name: 'fixtures',
  description: 'Write the golden protocol fixtures the Android client is tested against',
})
export class ChatFixturesSubCommand extends CommandRunner {
  private readonly logger = new Logger(ChatFixturesSubCommand.name);

  @Option({
    flags: '-o, --out [path]',
    description: `Directory to write into (default: ${DEFAULT_OUT})`,
  })
  parseOut(value: string): string {
    return value;
  }

  async run(_inputs: string[], options: FixturesOptions): Promise<void> {
    const target = resolve(process.cwd(), options.out ?? DEFAULT_OUT);

    try {
      await mkdir(target, { recursive: true });

      for (const { name, envelope } of fixtureFiles()) {
        // Trailing newline so the files are diff-friendly and git does not complain.
        await writeFile(join(target, name), `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
        this.logger.log(`wrote ${name}`);
      }

      this.logger.log(`${fixtureFiles().length} fixtures written to ${target}`);
    } catch (error: unknown) {
      this.logger.error(`Could not write the fixtures: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}
