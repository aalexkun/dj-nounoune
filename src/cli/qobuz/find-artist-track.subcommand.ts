import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { QobuzService } from '../../services/qobuz/qobuz.service';
import { getErrorMessage } from '../../utils/error.utils';
import { formatTrackMatch } from './track-match.printer';

interface FindArtistTrackOptions {
  artist?: string;
  album?: string;
  title?: string;
  limit?: number;
  json?: boolean;
}

/**
 * The CLI face of `QobuzService.searchArtistCatalog` — the artist-locked lookup behind the
 * `qobuz_find_artist_track` tool, so what the agent sees can be reproduced by hand.
 *
 * `search-track` is the loose one: it asks the catalog a free-text question and ranks whatever
 * comes back. This one resolves the artist first and never leaves them.
 */
@SubCommand({
  name: 'find-artist-track',
  description: 'Search the Qobuz catalog locked to one artist: their album, their tracks, nobody else’s',
})
@Injectable()
export class QobuzFindArtistTrackSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzFindArtistTrackSubCommand.name);

  constructor(private readonly qobuzService: QobuzService) {
    super();
  }

  async run(inputs: string[], options: FindArtistTrackOptions): Promise<void> {
    // Free-form arguments act as the artist, so both of these work:
    //   qobuz find-artist-track "Spice" --album 10
    //   qobuz find-artist-track --artist Spice --album 10
    const artist = options.artist ?? inputs.join(' ').trim();

    if (!artist) {
      this.logger.error('An artist name is required. Pass it as an argument or with --artist.');
      return;
    }

    try {
      const result = await this.qobuzService.searchArtistCatalog({
        artist,
        album: options.album,
        title: options.title,
        limit: options.limit,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.artist) {
        this.logger.warn(`No Qobuz artist named "${artist}".`);
        return;
      }

      this.logger.log(`Artist — ${result.artist.name} (id ${result.artist.id}, ${result.albums.length} album(s) listed)`);

      const others = result.candidates.filter((candidate) => candidate.id !== result.artist!.id);
      if (others.length > 0) {
        console.log(`  namesakes not searched: ${others.map((candidate) => `${candidate.name} (${candidate.id})`).join(', ')}`);
      }

      if (options.album) {
        if (!result.matchedAlbum) {
          this.logger.warn(`No album like "${options.album}" in their discography. Releases listed:`);
          for (const album of result.albums) {
            console.log(`  ${album.id} — ${album.title}${album.version ? ` (${album.version})` : ''}`);
          }
          return;
        }

        this.logger.log(
          `Album — ${result.matchedAlbum.title} (id ${result.matchedAlbum.id}, match ${result.albumScore?.toFixed(2)})`,
        );
      }

      if (result.tracks.length === 0) {
        this.logger.warn('No matching track. That is a real answer here — the search never left this artist.');
        return;
      }

      this.logger.log(`${result.tracks.length} track(s), read from the ${result.source}:`);
      for (const track of result.tracks) {
        console.log(formatTrackMatch(track, { artist, album: options.album }));
      }
    } catch (error) {
      this.logger.error(`Qobuz artist-locked search failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-a, --artist <artist>',
    description: 'Artist name to lock the search to (defaults to the free-form arguments)',
  })
  parseArtist(val: string): string {
    return val;
  }

  @Option({
    flags: '-b, --album <album>',
    description: 'Album title, resolved against that artist’s own discography',
  })
  parseAlbum(val: string): string {
    return val;
  }

  @Option({
    flags: '-t, --title <title>',
    description: 'Track title to look for within the artist’s catalog',
  })
  parseTitle(val: string): string {
    return val;
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Maximum tracks returned',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-j, --json',
    description: 'Print the raw result as JSON',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }
}
