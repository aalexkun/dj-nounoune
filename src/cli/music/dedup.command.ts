import { CommandRunner, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { DedupSearchCommand } from './dedup-search.subcommand';
import { DedupProcessCommand } from './dedup-process.subcommand';

@SubCommand({
  name: 'dedup',
  description: 'Song deduplication commands',
  subCommands: [DedupSearchCommand, DedupProcessCommand],
})
export class DedupCommand extends CommandRunner {
  private readonly logger = new Logger(DedupCommand.name);

  run(): Promise<void> {
    console.log('Use subcommands: search, process');
    return Promise.resolve();
  }
}
