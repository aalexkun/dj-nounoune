import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { QobuzFavoritesSubCommand } from './favorites.subcommand';
import { QobuzFavoriteAlbumsSubCommand } from './favorite-albums.subcommand';
import { QobuzAuthSubCommand } from './auth.subcommand';
import { QobuzImportFavoriteAlbumsSubCommand } from './import-favorite-albums.subcommand';
import { QobuzSearchTrackSubCommand } from './search-track.subcommand';
import { QobuzSearchCurrentTrackSubCommand } from './search-current-track.subcommand';
import { QobuzFindArtistTrackSubCommand } from './find-artist-track.subcommand';

@Command({
  name: 'qobuz',
  description: 'Qobuz Client commands',
  subCommands: [QobuzFavoritesSubCommand, QobuzFavoriteAlbumsSubCommand, QobuzAuthSubCommand, QobuzImportFavoriteAlbumsSubCommand, QobuzSearchTrackSubCommand, QobuzFindArtistTrackSubCommand, QobuzSearchCurrentTrackSubCommand],
})
@Injectable()
export class QobuzCommand extends CommandRunner {
  async run(inputs: string[], options: Record<string, unknown>): Promise<void> {
    console.log('Use subcommands: favorites, favorite-albums, import-favorite-albums, search-track, find-artist-track, search-current-track, auth');
  }
}
