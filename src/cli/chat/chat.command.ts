import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { ChatFixturesSubCommand } from './fixtures.subcommand';
import { ChatPruneSubCommand } from './prune.subcommand';

@Command({
  name: 'chat',
  description: 'Chat protocol tooling and conversation housekeeping',
  subCommands: [ChatFixturesSubCommand, ChatPruneSubCommand],
})
@Injectable()
export class ChatCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: fixtures, prune');
    return Promise.resolve();
  }
}
