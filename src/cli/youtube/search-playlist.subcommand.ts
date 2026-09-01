import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { YoutubeService } from '../../services/youtube/youtube.service';
import { getErrorMessage } from '../../utils/error.utils';
import { printPlaylists, printPlaylistTracks } from './track-match.printer';

interface SearchPlaylistOptions {
  limit?: number;
  tracks?: boolean;
  json?: boolean;
}

/**
 * Finds the playlist that stands in for an album.
 *
 * `--tracks` expands the top hit so the track list can be eyeballed before `import-playlist` writes
 * it: a YouTube playlist named after an album is not necessarily *that* album, and the cheapest
 * place to catch that is here rather than in the database.
 */
@SubCommand({
  name: 'search-playlist',
  description: 'Search YouTube for a playlist (the album equivalent) and print the matching playlist ids',
})
@Injectable()
export class YoutubeSearchPlaylistSubCommand extends CommandRunner {
  private readonly logger = new Logger(YoutubeSearchPlaylistSubCommand.name);

  constructor(private readonly youtubeService: YoutubeService) {
    super();
  }

  async run(inputs: string[], options: SearchPlaylistOptions): Promise<void> {
    const query = inputs.join(' ').trim();

    if (!query) {
      this.logger.error('A search query is required, e.g. youtube search-playlist "OK Computer Radiohead".');
      return;
    }

    try {
      const playlists = await this.youtubeService.searchPlaylists(query, options.limit);

      if (options.json) {
        console.log(JSON.stringify(playlists, null, 2));
        return;
      }

      if (playlists.length === 0) {
        this.logger.warn(`No YouTube playlist found for "${query}".`);
        return;
      }

      printPlaylists(this.logger, playlists);

      if (options.tracks) {
        const [best] = playlists;
        this.logger.log(`\nTracks of "${best.title}" (${best.id}):`);
        printPlaylistTracks(this.logger, await this.youtubeService.getPlaylistItems(best.id));
      }
    } catch (error) {
      this.logger.error(`YouTube playlist search failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Maximum playlists requested (default 25)',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '--tracks',
    description: 'Also list the tracks of the best-matching playlist',
    defaultValue: false,
  })
  parseTracks(): boolean {
    return true;
  }

  @Option({
    flags: '-j, --json',
    description: 'Print the raw matches as JSON',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }
}
