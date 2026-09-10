import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { DeduplicationService } from '../../services/deduplication/deduplication.service';
import { getErrorMessage } from '../../utils/error.utils';

interface DedupSearchOptions {
  dryRun?: boolean;
  limit?: number;
  createdAfter?: Date;
}

@SubCommand({
  name: 'search',
  description: 'Find likely duplicate songs and write them as groups: certain ones as auto, doubtful ones for review',
})
export class DedupSearchCommand extends CommandRunner {
  private readonly logger = new Logger(DedupSearchCommand.name);

  constructor(private readonly deduplicationService: DeduplicationService) {
    super();
  }

  async run(inputs: string[], options: DedupSearchOptions): Promise<void> {
    this.logger.log('Starting deduplication search...');

    try {
      const result = await this.deduplicationService.search({
        dryRun: options.dryRun,
        limit: options.limit,
        createdAfter: options.createdAfter,
      });

      for (const action of result.actions) {
        console.log(`  ${action}`);
      }

      if (options.dryRun) {
        this.logger.warn('Dry run: no group was written.');
      }

      this.logger.log(`Scanned ${result.scanned} song(s), skipped ${result.skipped} already pending, rejected ${result.rejected} candidate(s)`);
      this.logger.log(
        `${result.groups} group(s): ${result.autoEntries} auto entr(ies), ${result.reviewEntries} review entr(ies), ${result.errors} error(s)`,
      );

      if (result.reviewEntries > 0) {
        this.logger.log('Run `music dedup review` to have the review entries decided, then `music dedup process`.');
      }
    } catch (error) {
      this.logger.error(`Deduplication search failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Report the groups that would be written without writing them',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Songs looked up at most',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '--created-after <date>',
    description: 'Only songs created on or after this date (yyyy-mm-dd)',
  })
  parseCreatedAfter(val: string): Date {
    const date = new Date(val);

    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${val}`);
    }

    return date;
  }
}
