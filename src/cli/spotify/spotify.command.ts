import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { SpotifyAuthSubCommand } from './auth.subcommand';
import { SpotifyListUserLibrarySubCommand } from './list-user-library.subcommand';
import { SpotifyImportLikedSongsSubCommand } from './import-liked-songs.subcommand';

@Command({
  name: 'spotify',
  description: 'Spotify Client commands',
  subCommands: [SpotifyAuthSubCommand, SpotifyListUserLibrarySubCommand, SpotifyImportLikedSongsSubCommand],
})
@Injectable()
export class SpotifyCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: auth, listUserLibrary, import');
    return Promise.resolve();
  }
}
