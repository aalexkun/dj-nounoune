import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { YoutubeService } from '../../services/youtube/youtube.service';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { AddMpdRequest } from '../../services/mpd-client/requests/AddMpdRequest';
import { AddTagIdMpdRequest } from '../../services/mpd-client/requests/AddTagIdMpdRequest';
import { ClearMpdRequest } from '../../services/mpd-client/requests/ClearMpdRequest';
import { PlayMpdRequest } from '../../services/mpd-client/requests/PlayMpdRequest';
import { youtubeStreamUri } from '../../config/source-uri.util';
import { parseVideoTitle } from '../../services/youtube/youtube-track-match.util';
import { getErrorMessage } from '../../utils/error.utils';

interface PlayOptions {
  playlist?: string;
  search?: string;
  artist?: string;
  clear?: boolean;
}

/**
 * Queues YouTube audio into MPD through the Mopidy proxy.
 *
 * Nothing is written to Mongo here. These videos have no song document, and creating one for a
 * track somebody asked to hear once would seed the library with rows no importer ever saw — the
 * same stance `PlayQobuzHandler` takes for catalog-only Qobuz tracks. `import-playlist` is the path
 * that writes.
 */
@SubCommand({
  name: 'play',
  description: 'Queue YouTube audio in MPD, by video id, playlist id, or a search',
  argsDescription: {
    videoId: 'One or more video ids (11 characters). Omit when using --playlist or --search.',
  },
})
@Injectable()
export class YoutubePlaySubCommand extends CommandRunner {
  private readonly logger = new Logger(YoutubePlaySubCommand.name);

  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly mpdClientService: MpdClientService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(inputs: string[], options: PlayOptions): Promise<void> {
    try {
      const tracks = await this.resolveTracks(inputs, options);

      if (tracks.length === 0) {
        this.logger.warn('Nothing to queue.');
        return;
      }

      if (options.clear) {
        await this.mpdClientService.send(new ClearMpdRequest());
      }

      let queued = 0;

      for (const track of tracks) {
        try {
          await this.queue(track);
          this.logger.log(`Queued: ${track.artist || 'unknown artist'} - ${track.title}`);
          queued++;
        } catch (error) {
          this.logger.warn(`Could not queue ${track.videoId}: ${getErrorMessage(error)}`);
        }
      }

      if (queued === 0) {
        this.logger.error('Nothing could be queued.');
        return;
      }

      await this.mpdClientService.send(new PlayMpdRequest());
      this.logger.log(`Playback started with ${queued} YouTube track(s).`);
    } catch (error) {
      this.logger.error(`YouTube playback failed: ${getErrorMessage(error)}`);
    }
  }

  /** Whichever of the three input modes was used, reduced to a list of queueable tracks. */
  private async resolveTracks(inputs: string[], options: PlayOptions): Promise<Array<{ videoId: string; title: string; artist: string }>> {
    if (options.playlist) {
      const items = await this.youtubeService.getPlaylistItems(options.playlist);
      return items.map((item) => ({ videoId: item.videoId, title: item.title, artist: item.artist }));
    }

    if (options.search) {
      const match = await this.youtubeService.findTrack({ title: options.search, artist: options.artist });

      if (!match) {
        this.logger.warn(`No confident YouTube match for "${options.search}".`);
        return [];
      }

      this.logger.log(`Best match [${match.score.total.toFixed(2)}]: ${match.artist} - ${match.title} (${match.id})`);

      return [{ videoId: match.id, title: match.title, artist: match.artist }];
    }

    const videoIds = inputs.map((input) => input.trim()).filter((input) => !!input);

    if (videoIds.length === 0) {
      this.logger.error('Give a video id, or use --playlist <id> or --search "<title>".');
      return [];
    }

    // The ids are looked up rather than queued blind: it costs one quota unit for the batch and it
    // is what supplies the artist and title the queue entry has to be tagged with.
    const videos = await this.youtubeService.getVideos(videoIds);

    return videos.map((video) => {
      const { artist, title } = parseVideoTitle(video.snippet?.title ?? '', video.snippet?.channelTitle);
      return { videoId: video.id, title, artist };
    });
  }

  /**
   * The stream carries no tags of its own — the proxy hands MPD an audio body and nothing else — so
   * the queue entry is labelled by hand, exactly as the play handlers do for library songs.
   */
  private async queue(track: { videoId: string; title: string; artist: string }): Promise<void> {
    const uri = youtubeStreamUri(this.configService, track.videoId);
    const added = await this.mpdClientService.send(new AddMpdRequest(uri));
    const songId = added.songId;

    if (!songId) {
      throw new Error(`MPD returned no song id when queueing ${uri}`);
    }

    if (track.artist) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Artist', track.artist));
    if (track.title) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Title', track.title));
  }

  @Option({
    flags: '-p, --playlist <playlistId>',
    description: 'Queue every track of a playlist, in order',
  })
  parsePlaylist(val: string): string {
    return val;
  }

  @Option({
    flags: '-s, --search <title>',
    description: 'Search for a track and queue the best match',
  })
  parseSearch(val: string): string {
    return val;
  }

  @Option({
    flags: '-a, --artist <artist>',
    description: 'Artist name, used to narrow --search',
  })
  parseArtist(val: string): string {
    return val;
  }

  @Option({
    flags: '-c, --clear',
    description: 'Clear the MPD queue before adding',
    defaultValue: false,
  })
  parseClear(): boolean {
    return true;
  }
}
