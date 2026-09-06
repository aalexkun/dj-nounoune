import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { DeduplicationService } from '../../services/deduplication/deduplication.service';
import { getErrorMessage } from '../../utils/error.utils';

interface DedupReviewOptions {
  dryRun?: boolean;
  limit?: number;
  concurrency?: number;
}

@SubCommand({
  name: 'review',
  description: 'Ask the model whether each undecided review pair is the same recording, and record its verdict',
})
export class DedupReviewCommand extends CommandRunner {
  private readonly logger = new Logger(DedupReviewCommand.name);

  constructor(private readonly deduplicationService: DeduplicationService) {
    super();
  }

  async run(inputs: string[], options: DedupReviewOptions): Promise<void> {
    try {
      const result = await this.deduplicationService.review({
        dryRun: options.dryRun,
        limit: options.limit,
        concurrency: options.concurrency,
      });

      for (const action of result.actions) {
        console.log(`  ${action}`);
      }

      if (options.dryRun) {
        this.logger.warn('Dry run: verdicts were not recorded.');
      }

      this.logger.log(`Asked ${result.asked} pair(s): ${result.same} same, ${result.different} different, ${result.failed} failed`);

      if (result.asked === 0) {
        this.logger.log('Nothing to review — run `music dedup search` first.');
      }
    } catch (error) {
      this.logger.error(`Deduplication review failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Print the verdicts without recording them',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Pairs sent to the model at most',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-c, --concurrency <concurrency>',
    description: 'Parallel requests (default 5)',
  })
  parseConcurrency(val: string): number {
    return parseInt(val, 10);
  }
}
