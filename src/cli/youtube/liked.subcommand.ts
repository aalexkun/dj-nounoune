import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { YoutubeService } from '../../services/youtube/youtube.service';
import { parseIsoDuration, parseVideoTitle } from '../../services/youtube/youtube-track-match.util';
import { getErrorMessage } from '../../utils/error.utils';

interface LikedOptions {
  limit?: number;
  json?: boolean;
}

/**
 * Lists the signed-in account's liked videos. Requires OAuth — this is the account-scoped data the
 * `youtube auth` flow exists for.
 *
 * It lists rather than imports, deliberately. A liked video belongs to no playlist, so there is no
 * album to attach it to, and an album invented per video would be a row nothing else ever matches.
 * `youtube import-playlist` is the import path; this is how you find what to feed it.
 */
@SubCommand({
  name: 'liked',
  description: "List the signed-in account's liked YouTube videos (requires auth)",
})
@Injectable()
export class YoutubeLikedSubCommand extends CommandRunner {
  private readonly logger = new Logger(YoutubeLikedSubCommand.name);

  constructor(private readonly youtubeService: YoutubeService) {
    super();
  }

  async run(inputs: string[], options: LikedOptions): Promise<void> {
    if (!this.youtubeService.isAuthenticated()) {
      this.logger.error('Not authenticated. Run "npm run cli -- youtube auth" first.');
      return;
    }

    try {
      const videos = await this.youtubeService.getLikedVideos(options.limit ?? 50);

      if (options.json) {
        console.log(JSON.stringify(videos, null, 2));
        return;
      }

      if (videos.length === 0) {
        this.logger.warn('No liked videos on this account.');
        return;
      }

      this.logger.log(`${videos.length} liked video(s):`);

      for (const video of videos) {
        const { artist, title } = parseVideoTitle(video.snippet?.title ?? '', video.snippet?.channelTitle);
        const duration = parseIsoDuration(video.contentDetails?.duration);
        const minutes = Math.floor(duration / 60);
        const seconds = (duration % 60).toString().padStart(2, '0');

        console.log(`  id=${video.id} "${title}" — ${artist || 'unknown artist'} (${minutes}:${seconds})`);
      }
    } catch (error) {
      this.logger.error(`Could not list liked videos: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Maximum videos to list (default 50)',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-j, --json',
    description: 'Print the raw videos as JSON',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }
}
