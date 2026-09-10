import { SubCommand, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { SpotifyService } from '../../services/spotify/spotify.service';
import { describeSpotifyError } from '../../services/spotify/spotify-error.util';

interface ListUserLibraryOptions {
  limit?: string;
}

@SubCommand({
  name: 'list',
  description: 'List user saved tracks from Spotify',
})
@Injectable()
export class SpotifyListUserLibrarySubCommand extends CommandRunner {
  private readonly logger = new Logger(SpotifyListUserLibrarySubCommand.name);

  constructor(private readonly spotifyService: SpotifyService) {
    super();
  }

  async run(_inputs: string[], options: ListUserLibraryOptions = {}): Promise<void> {
    const limitOption = options.limit;
    const limit = limitOption === 'all' ? Number.MAX_SAFE_INTEGER : parseInt(limitOption ?? '', 10);

    if (isNaN(limit)) {
      this.logger.error('Invalid limit provided. Must be a number or "all".');
      return;
    }

    this.logger.log(`Fetching user library tracks... Limit: ${limitOption}`);

    let fetched = 0;
    let offset = 0;
    const fetchLimit = limit > 50 ? 50 : limit;

    try {
      do {
        const remaining = limit - fetched;
        const currentLimit = remaining < fetchLimit ? remaining : fetchLimit;

        const response = await this.spotifyService.listUserLibrary(currentLimit, offset);

        if (!response || !response.items || response.items.length === 0) {
          break;
        }

        for (const item of response.items) {
          this.logger.log(`Track: ${item.track.name} by ${item.track.artists.map((a) => a.name).join(', ')}`);
          this.logger.debug(JSON.stringify(item, null, 2));
        }

        fetched += response.items.length;
        offset += currentLimit;

        if (response.items.length < currentLimit || offset >= response.total) {
          break;
        }
      } while (fetched < limit);

      this.logger.log(`Finished fetching ${fetched} tracks.`);
    } catch (err) {
      this.logger.error(`Error listing user library: ${describeSpotifyError(err)}`);
    }
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Limit the number of tracks returned. Use "all" to return all tracks.',
    defaultValue: 'all',
  })
  parseLimit(val: string): string {
    return val;
  }
}
