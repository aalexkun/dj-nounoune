import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { QobuzFavoritesSubCommand } from './favorites.subcommand';

@Command({
  name: 'qobuz',
  description: 'Qobuz Client commands',
  subCommands: [QobuzFavoritesSubCommand],
})
@Injectable()
export class QobuzCommand extends CommandRunner {
  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    console.log('Use subcommands: favorites');
  }
}
