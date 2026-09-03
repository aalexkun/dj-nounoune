import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { QobuzService } from '../../services/qobuz/qobuz.service';
import { getErrorMessage } from '../../utils/error.utils';
import { printTrackMatches } from './track-match.printer';

interface SearchTrackOptions {
  title?: string;
  artist?: string;
  album?: string;
  limit?: number;
  json?: boolean;
  all?: boolean;
}

@SubCommand({
  name: 'search-track',
  description: 'Search the Qobuz catalog for a track and print the matching Qobuz track ids',
})
@Injectable()
export class QobuzSearchTrackSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzSearchTrackSubCommand.name);

  constructor(private readonly qobuzService: QobuzService) {
    super();
  }

  async run(inputs: string[], options: SearchTrackOptions): Promise<void> {
    // Free-form arguments act as the title, so both of these work:
    //   qobuz search-track "Push It to the Limit" --album Scarface
    //   qobuz search-track --title "Push It to the Limit" --album Scarface
    const title = options.title ?? inputs.join(' ').trim();

    if (!title) {
      this.logger.error('A track title is required. Pass it as an argument or with --title.');
      return;
    }

    try {
      const matches = await this.qobuzService.searchTracks({
        title,
        artist: options.artist,
        album: options.album,
        limit: options.limit,
        includeRejected: options.all,
      });

      if (options.json) {
        console.log(JSON.stringify(matches, null, 2));
        return;
      }

      if (matches.length === 0) {
        const artistPart = options.artist ? ` by ${options.artist}` : '';
        const albumPart = options.album ? ` on ${options.album}` : '';
        this.logger.warn(`No Qobuz track found for "${title}"${artistPart}${albumPart}.`);
        return;
      }

      printTrackMatches(this.logger, matches, { artist: options.artist, album: options.album });
    } catch (error) {
      this.logger.error(`Qobuz track search failed: ${getErrorMessage(error)}`);
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
    description: 'Maximum catalog hits requested per query (default 25)',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '--all',
    description: 'Show every catalog hit, including the ones dropped for failing a stated criterion',
    defaultValue: false,
  })
  parseAll(): boolean {
    return true;
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
