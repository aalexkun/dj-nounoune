import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { PromptusPlaySubcommand } from './play.subcommand';
import { PromptusSearchCommand } from './search.command';
import { PromptusChatSubcommand } from './chat.subcommand';
import { PromptusClearCacheSubcommand } from './clear-cache.subcommand';

@Command({
  name: 'promptus',
  description: 'Ai inquiry commands',
  subCommands: [PromptusPlaySubcommand, PromptusSearchCommand, PromptusChatSubcommand, PromptusClearCacheSubcommand],
})
@Injectable()
export class PromptusCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: play, search, chat, clear-cache');
    return Promise.resolve();
  }
}
