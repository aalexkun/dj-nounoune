import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { YoutubeService } from '../../services/youtube/youtube.service';
import { getErrorMessage } from '../../utils/error.utils';
import { printTrackMatches } from './track-match.printer';

interface SearchTrackOptions {
  title?: string;
  artist?: string;
  album?: string;
  limit?: number;
  json?: boolean;
}

@SubCommand({
  name: 'search-track',
  description: 'Search YouTube for a track and print the matching video ids',
})
@Injectable()
export class YoutubeSearchTrackSubCommand extends CommandRunner {
  private readonly logger = new Logger(YoutubeSearchTrackSubCommand.name);

  constructor(private readonly youtubeService: YoutubeService) {
    super();
  }

  async run(inputs: string[], options: SearchTrackOptions): Promise<void> {
    // Free-form arguments act as the title, so both of these work:
    //   youtube search-track "Push It to the Limit" --artist Scarface
    //   youtube search-track --title "Push It to the Limit" --artist Scarface
    const title = options.title ?? inputs.join(' ').trim();

    if (!title) {
      this.logger.error('A track title is required. Pass it as an argument or with --title.');
      return;
    }

    try {
      const matches = await this.youtubeService.searchTracks({
        title,
        artist: options.artist,
        album: options.album,
        limit: options.limit,
      });

      if (options.json) {
        console.log(JSON.stringify(matches, null, 2));
        return;
      }

      if (matches.length === 0) {
        const artistPart = options.artist ? ` by ${options.artist}` : '';
        const albumPart = options.album ? ` on ${options.album}` : '';
        this.logger.warn(`No YouTube music video found for "${title}"${artistPart}${albumPart}.`);
        return;
      }

      printTrackMatches(this.logger, matches, { artist: options.artist, album: options.album });
    } catch (error) {
      this.logger.error(`YouTube track search failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-t, --title <title>',
    description: 'Track title to search for (defaults to the free-form arguments)',
  })
  parseTitle(val: string): string {
    return val;
  }

  @Option({
    flags: '-a, --artist <artist>',
    description: 'Artist name, used to narrow and rank the search',
  })
  parseArtist(val: string): string {
    return val;
  }

  @Option({
    flags: '-b, --album <album>',
    description: 'Album title, used to narrow and rank the search',
  })
  parseAlbum(val: string): string {
    return val;
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Maximum hits requested per query (default 25)',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-j, --json',
    description: 'Print the raw ranked matches as JSON',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }
}
