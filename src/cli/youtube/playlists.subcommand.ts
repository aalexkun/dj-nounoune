import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { YoutubeService } from '../../services/youtube/youtube.service';
import { getErrorMessage } from '../../utils/error.utils';
import { printPlaylists } from './track-match.printer';

interface PlaylistsOptions {
  limit?: number;
  json?: boolean;
}

/**
 * Lists the signed-in account's own playlists, private ones included. Requires OAuth.
 *
 * The ids it prints go straight to `youtube import-playlist`, which is the point: a playlist the
 * user curated themselves is the closest thing this source has to a hand-assembled album.
 */
@SubCommand({
  name: 'playlists',
  description: "List the signed-in account's own YouTube playlists (requires auth)",
})
@Injectable()
export class YoutubePlaylistsSubCommand extends CommandRunner {
  private readonly logger = new Logger(YoutubePlaylistsSubCommand.name);

  constructor(private readonly youtubeService: YoutubeService) {
    super();
  }

  async run(inputs: string[], options: PlaylistsOptions): Promise<void> {
    if (!this.youtubeService.isAuthenticated()) {
      this.logger.error('Not authenticated. Run "npm run cli -- youtube auth" first.');
      return;
    }

    try {
      const playlists = await this.youtubeService.getMyPlaylists(options.limit ?? 50);

      if (options.json) {
        console.log(JSON.stringify(playlists, null, 2));
        return;
      }

      if (playlists.length === 0) {
        this.logger.warn('This account owns no playlist.');
        return;
      }

      printPlaylists(this.logger, playlists);
    } catch (error) {
      this.logger.error(`Could not list playlists: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Maximum playlists to list (default 50)',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-j, --json',
    description: 'Print the raw playlists as JSON',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }
}
