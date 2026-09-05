import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { SpotifyAuthSubCommand } from './auth.subcommand';
import { SpotifyListUserLibrarySubCommand } from './list-user-library.subcommand';
import { SpotifyImportLikedSongsSubCommand } from './import-liked-songs.subcommand';
import { SpotifySearchTrackSubCommand } from './search-track.subcommand';
import { SpotifySearchArtistSubCommand } from './search-artist.subcommand';

@Command({
  name: 'spotify',
  description: 'Spotify Client commands',
  subCommands: [
    SpotifyAuthSubCommand,
    SpotifyListUserLibrarySubCommand,
    SpotifyImportLikedSongsSubCommand,
    SpotifySearchTrackSubCommand,
    SpotifySearchArtistSubCommand,
  ],
})
@Injectable()
export class SpotifyCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: auth, list, import, search-track, search-artist');
    return Promise.resolve();
  }
}
