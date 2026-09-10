import { CommandRunner, SubCommand } from 'nest-commander';
import { DedupSearchCommand } from './dedup-search.subcommand';
import { DedupReviewCommand } from './dedup-review.subcommand';
import { DedupProcessCommand } from './dedup-process.subcommand';

@SubCommand({
  name: 'dedup',
  description: 'Song deduplication: search for duplicates, review the doubtful ones, then process the merges',
  subCommands: [DedupSearchCommand, DedupReviewCommand, DedupProcessCommand],
})
export class DedupCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: search, review, process');
    return Promise.resolve();
  }
}
