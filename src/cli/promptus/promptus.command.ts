import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { PromptusPlaySubcommand } from './play.subcommand';
import { PromptusSearchCommand } from './search.command';
import { PromptusChatSubcommand } from './chat.subcommand';

@Command({
  name: 'promptus',
  description: 'Ai inquiry commands',
  subCommands: [PromptusPlaySubcommand, PromptusSearchCommand, PromptusChatSubcommand],
})
@Injectable()
export class PromptusCommand extends CommandRunner {
  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    console.log('Use subcommands:  play');
  }
}
