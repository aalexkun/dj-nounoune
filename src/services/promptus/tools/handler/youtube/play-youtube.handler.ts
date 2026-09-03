import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { YoutubeToolsDefinition } from '../../definition/youtube-tools.definition';
import { YoutubeService } from '../../../../youtube/youtube.service';
import { parseVideoTitle, stripReleasePrefix } from '../../../../youtube/youtube-track-match.util';
import { youtubeStreamUri } from '../../../../../config/source-uri.util';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../../../mpd-client/requests/AddMpdRequest';
import { AddTagIdMpdRequest } from '../../../../mpd-client/requests/AddTagIdMpdRequest';
import { PlayMpdRequest } from '../../../../mpd-client/requests/PlayMpdRequest';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface PlayYoutubeArgs {
  videoIds?: string[];
  playlistIds?: string[];
  clearQueue: boolean;
}

/** A video resolved to what the queue entry has to be tagged with. */
type ResolvedVideo = {
  id: string;
  title: string;
  artist: string;
  album: string;
};

/**
 * Plays straight from YouTube, for the recordings neither the library nor Qobuz has.
 *
 * The same stance as `PlayQobuzHandler`, for the same reason: nothing is written to Mongo. These
 * videos have no song document, and inventing one for something the user asked to hear once would
 * seed the library with rows no importer ever saw. `youtube import-playlist` on the CLI is the
 * path that writes.
 */
export class PlayYoutubeHandler implements ToolHandler {
  readonly name = YoutubeToolsDefinition.playCommand.name;
  private readonly logger = new Logger('PlayYoutubeHandler');

  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly mpdClientService: MpdClientService,
    private readonly configService: ConfigService,
  ) {}

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }

  private isPlayYoutubeArgs(args: unknown): args is PlayYoutubeArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;

    if (typeof record.clearQueue !== 'boolean') {
      return false;
    }

    const videosOk = record.videoIds === undefined || record.videoIds === null || this.isStringArray(record.videoIds);
    const listsOk =
      record.playlistIds === undefined || record.playlistIds === null || this.isStringArray(record.playlistIds);

    return videosOk && listsOk;
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isPlayYoutubeArgs(args)) {
      return this.reply(
        `Invalid arguments provided to ${this.name}. Expected clearQueue as a boolean, plus videoIds and/or playlistIds as arrays of strings.`,
      );
    }

    const playlistIds = args.playlistIds ?? [];
    const videoIds = args.videoIds ?? [];

    if (playlistIds.length === 0 && videoIds.length === 0) {
      return this.reply('Nothing to play: give at least one YouTube video id or playlist id.');
    }

    const failures: string[] = [];
    const videos = await this.resolveVideos(playlistIds, videoIds, failures);

    if (videos.length === 0) {
      return this.reply(`None of those YouTube ids resolved to a playable video.${this.renderFailures(failures)}`);
    }

    if (args.clearQueue) {
      try {
        await this.mpdClientService.send(new ClearMpdRequest());
      } catch (error) {
        this.logger.error(`Failed to clear the MPD queue: ${getErrorMessage(error)}`);
      }
    }

    const queued: string[] = [];

    for (const video of videos) {
      try {
        await this.queue(video);
        queued.push([video.artist, video.album, video.title].filter(Boolean).join(' - '));
      } catch (error) {
        this.logger.warn(`Could not queue YouTube video ${video.id}: ${getErrorMessage(error)}`);
        failures.push(`${video.artist} - ${video.title} (queueing failed)`);
      }
    }

    if (queued.length === 0) {
      return this.reply(`Nothing could be queued.${this.renderFailures(failures)}`);
    }

    try {
      await this.mpdClientService.send(new PlayMpdRequest());
      this.logger.log(`Playback started with ${queued.length} YouTube track(s).`);
    } catch (error) {
      this.logger.error(`Failed to start playback: ${getErrorMessage(error)}`);
    }

    const list = queued.map((entry) => `- ${entry}`).join('\n');

    return this.reply(
      `Streaming from YouTube:\n\n${list}${this.renderFailures(failures)}\n\n` +
        'Tell the user this is coming from YouTube rather than from their library or from Qobuz.',
    );
  }

  /** Playlists first, so one queued alongside loose videos keeps its running order. */
  private async resolveVideos(playlistIds: string[], videoIds: string[], failures: string[]): Promise<ResolvedVideo[]> {
    const resolved: ResolvedVideo[] = [];

    for (const playlistId of playlistIds) {
      try {
        const playlist = await this.youtubeService.getPlaylist(playlistId);
        const items = await this.youtubeService.getPlaylistItems(playlistId);

        if (items.length === 0) {
          failures.push(`playlist ${playlistId} holds no playable video`);
          continue;
        }

        // The record's name, not the playlist's: a release playlist is titled `Album - Kid A`, and
        // that prefix would read as part of the title on the queue entry.
        const album = stripReleasePrefix(playlist?.title ?? '');

        for (const item of items) {
          resolved.push({
            id: item.videoId,
            title: item.title,
            artist: item.artist || item.channelTitle || '',
            album,
          });
        }
      } catch (error) {
        this.logger.warn(`Could not read YouTube playlist ${playlistId}: ${getErrorMessage(error)}`);
        failures.push(`playlist ${playlistId} (${getErrorMessage(error)})`);
      }
    }

    if (videoIds.length > 0) {
      try {
        // Batched rather than looked up one at a time: 50 ids for one quota unit, against one unit
        // each. The lookup is what supplies the artist and title the queue entry is tagged with.
        const videos = await this.youtubeService.getVideos(videoIds);
        const found = new Set(videos.map((video) => video.id));

        for (const video of videos) {
          const { artist, title } = parseVideoTitle(video.snippet?.title ?? '', video.snippet?.channelTitle);
          resolved.push({ id: video.id, title, artist, album: '' });
        }

        for (const videoId of videoIds) {
          if (!found.has(videoId)) {
            failures.push(`video ${videoId} (no such video, or it is private)`);
          }
        }
      } catch (error) {
        this.logger.warn(`Could not read the YouTube videos: ${getErrorMessage(error)}`);
        failures.push(`videos ${videoIds.join(', ')} (${getErrorMessage(error)})`);
      }
    }

    return resolved;
  }

  /**
   * The stream carries no tags of its own — the proxy hands MPD an audio body and nothing else — so
   * the queue entry is labelled by hand, exactly as the other play handlers do.
   */
  private async queue(video: ResolvedVideo): Promise<void> {
    const uri = youtubeStreamUri(this.configService, video.id);
    const added = await this.mpdClientService.send(new AddMpdRequest(uri));
    const songId = added.songId;

    if (!songId) {
      throw new Error(`MPD returned no song id when queueing ${uri}`);
    }

    if (video.artist) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Artist', video.artist));
    if (video.title) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Title', video.title));
    if (video.album) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Album', video.album));
  }

  private renderFailures(failures: string[]): string {
    if (failures.length === 0) return '';

    return `\n\nSkipped:\n${failures.map((failure) => `- ${failure}`).join('\n')}`;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
