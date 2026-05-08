import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { QobuzFavoritesSubCommand } from './favorites.subcommand';
import { QobuzFavoriteAlbumsSubCommand } from './favorite-albums.subcommand';
import { QobuzAuthSubCommand } from './auth.subcommand';

@Command({
  name: 'qobuz',
  description: 'Qobuz Client commands',
  subCommands: [QobuzFavoritesSubCommand, QobuzFavoriteAlbumsSubCommand, QobuzAuthSubCommand],
})
@Injectable()
export class QobuzCommand extends CommandRunner {
  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    console.log('Use subcommands: favorites, favorite-albums, auth');
  }
}
