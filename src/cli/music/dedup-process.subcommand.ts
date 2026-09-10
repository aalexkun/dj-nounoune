import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { DeduplicationService } from '../../services/deduplication/deduplication.service';
import { getErrorMessage } from '../../utils/error.utils';

interface DedupProcessCommandOptions {
  dryRun?: boolean;
}

@SubCommand({
  name: 'process',
  description: 'Merge the pending groups: auto entries and entries the review decided are the same recording',
})
export class DedupProcessCommand extends CommandRunner {
  private readonly logger = new Logger(DedupProcessCommand.name);

  constructor(private readonly deduplicationService: DeduplicationService) {
    super();
  }

  async run(inputs: string[], options: DedupProcessCommandOptions): Promise<void> {
    const dryRun = options.dryRun ?? false;

    if (dryRun) {
      this.logger.warn('DRY RUN ACTIVE: No changes will be committed.');
    }

    try {
      const result = await this.deduplicationService.process({ dryRun });

      for (const action of result.actions) {
        console.log(`  ${action}`);
      }

      this.logger.log(`\nDedup processing complete.`);
      this.logger.log(`  Groups: ${result.groups}, completed: ${result.completed}, errors: ${result.errors}`);
      this.logger.log(`  Merged: ${result.merged}, left as different: ${result.leftDifferent}, still waiting for review: ${result.waiting}`);

      if (result.waiting > 0) {
        this.logger.log('Run `music dedup review` to decide the waiting entries.');
      }

      if (dryRun) {
        this.logger.warn('DRY RUN: No changes were committed.');
      }
    } catch (error) {
      this.logger.error(`Deduplication processing failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Preview the merges without committing to the database',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }
}
