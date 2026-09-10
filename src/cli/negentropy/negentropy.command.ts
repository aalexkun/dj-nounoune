import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { NegentropyRunSubCommand } from './run.subcommand';

@Command({
  name: 'negentropy',
  description: 'Queue quality upgrade commands',
  subCommands: [NegentropyRunSubCommand],
})
@Injectable()
export class NegentropyCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: run');
    return Promise.resolve();
  }
}
