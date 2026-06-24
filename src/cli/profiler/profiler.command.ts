import { Command, CommandRunner } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { ProfilerRunSubCommand } from './run.subcommand';

@Command({
  name: 'profiler',
  arguments: '<task>',
  description: 'Run data profiling tools',
  subCommands: [
    ProfilerRunSubCommand,
  ],
})
export class ProfilerCommand extends CommandRunner {
  private readonly logger = new Logger(ProfilerCommand.name);

  async run(inputs: string[], options: Record<string, unknown>): Promise<void> {
    console.log('Use subcommands: run');
  }
}
