import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { SpotifyService } from '../../services/spotify/spotify.service';
import { describeSpotifyError } from '../../services/spotify/spotify-error.util';
import { formatTrackMatch, printAlbums } from './track-match.printer';

interface SearchArtistOptions {
  artist?: string;
  album?: string;
  title?: string;
  limit?: number;
  json?: boolean;
}

/**
 * The CLI face of `SpotifyService.searchArtistCatalog` — the artist-locked lookup behind the
 * `spotify_search_music` and `spotify_search_artist` tools, so what the agent sees can be
 * reproduced by hand.
 *
 * `search-track` is the loose one: it asks the catalog a free-text question and ranks whatever
 * comes back. This one resolves the artist first and never leaves them.
 */
@SubCommand({
  name: 'search-artist',
  description: 'Search the Spotify catalog locked to one artist: their releases, their album, their tracks, nobody else’s',
})
@Injectable()
export class SpotifySearchArtistSubCommand extends CommandRunner {
  private readonly logger = new Logger(SpotifySearchArtistSubCommand.name);

  constructor(private readonly spotifyService: SpotifyService) {
    super();
  }

  async run(inputs: string[], options: SearchArtistOptions): Promise<void> {
    // Free-form arguments act as the artist, so both of these work:
    //   spotify search-artist "Spice" --album 10
    //   spotify search-artist --artist Spice --album 10
    const artist = options.artist ?? inputs.join(' ').trim();

    if (!artist) {
      this.logger.error('An artist name is required. Pass it as an argument or with --artist.');
      return;
    }

    try {
      const result = await this.spotifyService.searchArtistCatalog({
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
        this.logger.warn(`No Spotify artist named "${artist}".`);
        return;
      }

      this.logger.log(`Artist — ${result.artist.name} (id ${result.artist.id}, ${result.albums.length} release(s) listed)`);

      const others = result.candidates.filter((candidate) => candidate.id !== result.artist!.id);
      if (others.length > 0) {
        console.log(`  namesakes not searched: ${others.map((candidate) => `${candidate.name} (${candidate.id})`).join(', ')}`);
      }

      if (options.album) {
        if (!result.matchedAlbum) {
          this.logger.warn(`No release like "${options.album}" in their discography. Releases listed:`);
          printAlbums(this.logger, result.albums);
          return;
        }

        this.logger.log(`Album — ${result.matchedAlbum.title} (id ${result.matchedAlbum.id}, match ${result.albumScore?.toFixed(2)})`);
      }

      if (result.tracks.length > 0) {
        this.logger.log(`${result.tracks.length} track(s)${result.source === 'album' ? ', in running order' : ', best match first'}:`);
        for (const match of result.tracks) {
          console.log(formatTrackMatch(match, { artist }));
        }
        return;
      }

      if (options.title) {
        this.logger.warn(`${result.artist.name} has no recording like "${options.title}" on Spotify.`);
        return;
      }

      printAlbums(this.logger, result.albums);
    } catch (error) {
      this.logger.error(`Spotify artist search failed: ${describeSpotifyError(error)}`);
    }
  }

  @Option({
    flags: '-a, --artist <artist>',
    description: 'Artist name (defaults to the free-form arguments)',
  })
  parseArtist(val: string): string {
    return val;
  }

  @Option({
    flags: '-b, --album <album>',
    description: 'Album title, resolved against the artist’s own discography',
  })
  parseAlbum(val: string): string {
    return val;
  }

  @Option({
    flags: '-t, --title <title>',
    description: 'Track title, searched with the artist filter and verified by artist id',
  })
  parseTitle(val: string): string {
    return val;
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Maximum tracks reported',
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
