import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { YoutubeAuthSubCommand } from './auth.subcommand';
import { YoutubeSearchTrackSubCommand } from './search-track.subcommand';
import { YoutubeSearchPlaylistSubCommand } from './search-playlist.subcommand';
import { YoutubeImportPlaylistSubCommand } from './import-playlist.subcommand';
import { YoutubePlaySubCommand } from './play.subcommand';
import { YoutubeLikedSubCommand } from './liked.subcommand';
import { YoutubePlaylistsSubCommand } from './playlists.subcommand';

@Command({
  name: 'youtube',
  description: 'YouTube Client commands',
  subCommands: [
    YoutubeAuthSubCommand,
    YoutubeSearchTrackSubCommand,
    YoutubeSearchPlaylistSubCommand,
    YoutubeImportPlaylistSubCommand,
    YoutubePlaySubCommand,
    YoutubeLikedSubCommand,
    YoutubePlaylistsSubCommand,
  ],
})
@Injectable()
export class YoutubeCommand extends CommandRunner {
  async run(): Promise<void> {
    console.log(
      'Use subcommands: auth, search-track, search-playlist, import-playlist, play, liked, playlists',
    );
  }
}
