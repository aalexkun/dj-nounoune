import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { ChatFixturesSubCommand } from './fixtures.subcommand';

@Command({
  name: 'chat',
  description: 'Chat protocol tooling',
  subCommands: [ChatFixturesSubCommand],
})
@Injectable()
export class ChatCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: fixtures');
    return Promise.resolve();
  }
}
