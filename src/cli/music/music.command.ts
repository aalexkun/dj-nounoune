import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { ImportCommand } from './import.command';
import { ClearCommand } from './clear.command';
import { EnrichCommand } from './enrich.command';

@Command({
  name: 'music',
  description: 'Music Database management commands',
  subCommands: [ImportCommand, ClearCommand, EnrichCommand],
})
@Injectable()
export class MusicCommand extends CommandRunner {
  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    console.log('Use subcommands: clear, import, enrich');
  }
}
