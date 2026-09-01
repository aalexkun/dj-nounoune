import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { YoutubeService } from '../../services/youtube/youtube.service';
import { getErrorMessage } from '../../utils/error.utils';

interface ImportPlaylistOptions {
  dryRun?: boolean;
}

/**
 * Imports a YouTube playlist into the library as an album.
 *
 * This is the only path that writes YouTube songs to Mongo. A playlist is the sole YouTube object
 * carrying the structure an `Album` needs — a title, an ordered track list, artwork and a stable id
 * — so nothing else can be imported without inventing one.
 */
@SubCommand({
  name: 'import-playlist',
  description: 'Import a YouTube playlist into the library as an album',
  argsDescription: {
    playlistId: 'The playlist id (PL… or OLAK5uy_… for a YouTube Music release)',
  },
})
@Injectable()
export class YoutubeImportPlaylistSubCommand extends CommandRunner {
  private readonly logger = new Logger(YoutubeImportPlaylistSubCommand.name);

  constructor(private readonly youtubeService: YoutubeService) {
    super();
  }

  async run(inputs: string[], options: ImportPlaylistOptions): Promise<void> {
    const playlistId = inputs[0]?.trim();

    if (!playlistId) {
      this.logger.error('A playlist id is required, e.g. youtube import-playlist OLAK5uy_abc123.');
      return;
    }

    try {
      const result = await this.youtubeService.importPlaylist(playlistId, options.dryRun ?? false);

      this.logger.log(`\nPlaylist: "${result.playlistTitle}" (${result.playlistId})`);
      this.logger.log(`Album artist: ${result.artistName}`);
      this.logger.log(`  Tracks seen:       ${result.tracksSeen}`);
      this.logger.log(`  Songs created:     ${result.songsCreated}`);
      this.logger.log(`  Sources attached:  ${result.sourcesAttached}`);
      this.logger.log(`  Already present:   ${result.alreadyPresent}`);

      if (result.skipped.length > 0) {
        this.logger.warn(`  Failed: ${result.skipped.length}`);
        for (const skipped of result.skipped) {
          console.log(`    - ${skipped}`);
        }
      }
    } catch (error) {
      this.logger.error(`YouTube playlist import failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'List what would be imported without writing anything',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }
}
