import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { SpotifyAuthSubCommand } from './auth.subcommand';

@Command({
  name: 'spotify',
  description: 'Spotify Client commands',
  subCommands: [SpotifyAuthSubCommand],
})
@Injectable()
export class SpotifyCommand extends CommandRunner {
  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    console.log('Use subcommands: auth');
  }
}
