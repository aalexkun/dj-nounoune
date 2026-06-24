import { CommandRunner, SubCommand, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { SpotifyService } from '../../services/spotify/spotify.service';

@SubCommand({
  name: 'import',
  description: 'Import user liked songs from Spotify to MongoDB',
})
@Injectable()
export class SpotifyImportLikedSongsSubCommand extends CommandRunner {
  private readonly logger = new Logger(SpotifyImportLikedSongsSubCommand.name);

  constructor(private readonly spotifyService: SpotifyService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    const dryRun = options.dryRun === true;
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    
    if (dryRun) {
      this.logger.log('Running in DRY-RUN mode. No data will be saved.');
    }

    await this.spotifyService.importLikedSongs(dryRun, limit);
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Dry run, do not save anything to the database',
    defaultValue: false,
  })
  parseDryRun() {
    return true;
  }

  @Option({
    flags: '-l, --limit [limit]',
    description: 'Limit the number of songs to import. Default is all.',
  })
  parseLimit(val: string) {
    return val;
  }
}
