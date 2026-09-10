import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { NegentropyService } from '../../services/negentropy/negentropy.service';
import { getErrorMessage } from '../../utils/error.utils';

interface NegentropyRunOptions {
  dryRun?: boolean;
  limit?: number;
}

@SubCommand({
  name: 'run',
  description: 'Run one pass over the upcoming MPD queue, upgrading low quality tracks to Qobuz, Spotify or YouTube',
})
@Injectable()
export class NegentropyRunSubCommand extends CommandRunner {
  private readonly logger = new Logger(NegentropyRunSubCommand.name);

  constructor(private readonly negentropyService: NegentropyService) {
    super();
  }

  async run(inputs: string[], options: NegentropyRunOptions): Promise<void> {
    try {
      const result = await this.negentropyService.runOnce({
        dryRun: options.dryRun,
        limit: options.limit,
      });

      if (options.dryRun) {
        this.logger.warn('Dry run: nothing was written to Mongo or to the MPD queue.');
        this.logger.warn('The providers were still queried, and with no job records written they will be queried again next run.');
      }

      const calls = result.providerLookups;

      this.logger.log(
        `Scanned ${result.scanned} upcoming entrie(s), ${result.candidates} low quality candidate(s), ${result.lookups} song(s) looked up ` +
          `(qobuz ${calls.qobuz}, spotify ${calls.spotify}, youtube ${calls.youtube})`,
      );
      this.logger.log(
        `Upgraded ${result.upgraded}, reused ${result.reused}, no match ${result.noMatch}, failed ${result.failed}, skipped ${result.skipped}, deferred ${result.deferred}`,
      );

      for (const action of result.actions) {
        console.log(`  ${action}`);
      }

      if (result.actions.length === 0) {
        this.logger.log('Nothing to do — the upcoming queue is already as good as it gets.');
      }
    } catch (error) {
      this.logger.error(`Negentropy pass failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Report what would be swapped without writing anything',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Songs looked up this pass, each taking up to three provider calls (default 5)',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }
}
