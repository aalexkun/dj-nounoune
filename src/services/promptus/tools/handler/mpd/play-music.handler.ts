import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MusicSearchResultsSchema } from '../../../agent/disc-jockey/disc-jockey.agent';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../../../mpd-client/requests/AddMpdRequest';
import { PlayMpdRequest } from '../../../../mpd-client/requests/PlayMpdRequest';
import { AddTagIdMpdRequest } from '../../../../mpd-client/requests/AddTagIdMpdRequest';
import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from '../../../../redis-cache/redis-cache.service';
import { qobuzStreamUri, spotifyStreamUri, youtubeStreamUri } from '../../../../../config/source-uri.util';
import { getBestSource } from '../../../../../config/best-source.util';
import { PlaylistReconcilerService } from '../../../../queue-state/playlist-reconciler.service';
import { PlaylistMessageRefSchema, playlistMessageKey } from '../../../../queue-state/queue-state.schema';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface PlayMusicArgs {
  cacheKey: string;
  clearQueue: boolean;
}

export class PlayMusicHandler implements ToolHandler {
  readonly name: string = MpdToolsDefinition.playMpdCommand.name;
  private readonly logger = new Logger('PlayMusicHandler');

  constructor(
    private mpdClientService: MpdClientService,
    private configService: ConfigService,
    private redisCacheService: RedisCacheService,
    private playlistReconciler: PlaylistReconcilerService,
  ) {}

  isPlayMusicArgs(args: unknown): args is PlayMusicArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;
    return typeof record.cacheKey === 'string' && typeof record.clearQueue === 'boolean';
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isPlayMusicArgs(args)) {
      throw new Error(`Invalid arguments provided to play_music. Expected an array of songs with sourceIds.`);
    }

    const songsQueued: string[] = [];

    if (args.clearQueue) {
      try {
        await this.mpdClientService.send(new ClearMpdRequest());
      } catch (e) {
        this.logger.error(e);
        this.logger.error('Failed to clear MPD playlist');
      }
    }

    const songs = await this.redisCacheService.get(args.cacheKey, MusicSearchResultsSchema);

    if (!songs) {
      throw new Error(`No songs found for cacheKey: ${args.cacheKey}`);
    }

    // What actually reached the queue, so the playlist message can be bound to it afterwards.
    const queuedSongIds: string[] = [];
    const queuedUris: string[] = [];

    for (const song of songs) {
      if (song.source === undefined) {
        this.logger.error(`SourceId is undefined for song: ${JSON.stringify(song)}`);
        continue;
      }

      // Whichever source scores highest — the same function the playlist payload and the queue
      // watcher use, so the row the user is looking at names the source playback really picked.
      const bestSource = getBestSource(song.source);

      if (!bestSource) {
        this.logger.error(`No source found for song: ${JSON.stringify(song)}`);
        continue;
      }

      this.logger.debug(`Selected best source from ${song.source.length} option(s) for song: ${song.title || 'Unknown'}`);

      let uri: string;
      if (bestSource.name === 'qobuz') {
        uri = qobuzStreamUri(this.configService, bestSource.sourceId);
      } else if (bestSource.name === 'spotify') {
        uri = spotifyStreamUri(this.configService, bestSource.sourceId);
      } else if (bestSource.name === 'youtube') {
        uri = youtubeStreamUri(this.configService, bestSource.sourceId);
      } else {
        uri = bestSource.sourceId;
      }

      try {
        const addResponse = await this.mpdClientService.send(new AddMpdRequest(uri));
        const songId = addResponse.songId;
        if (songId) {
          if (song.artist) {
            await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Artist', song.artist));
          }
          if (song.title) {
            await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Title', song.title));
          }
          if (song.album) {
            await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Album', song.album));
          }
        }
        songsQueued.push(`${song.artist} - ${song.album} - ${song.title}`);
        queuedSongIds.push(song.id);
        queuedUris.push(uri);
      } catch {
        this.logger.debug(`Could not added to playlist: ${song.title} - ${song.artist} - ${song.album}`);
      }
    }

    await this.bindPlaylistMessage(args.cacheKey, queuedSongIds, queuedUris);

    try {
      await this.mpdClientService.send(new PlayMpdRequest());
      this.logger.log('Playback started.');
    } catch (e) {
      this.logger.error(e);
      this.logger.error('Failed to start playback');
    }

    const markdownList = songsQueued.map((item) => `- ${item}`).join('\n');

    return {
      message: `Songs queued successfully:\n\n${markdownList}`,
      name: 'play_music',
      type: 'string',
    };
  }

  /**
   * Hands the queue watcher the message it should keep in step with MPD.
   *
   * This is the moment the disc jockey's chosen songs stopped being a cached list and became queue
   * entries, so it is the only point at which the binding is true. Best effort: a playlist that
   * cannot be bound still played, it simply will not update itself afterwards.
   */
  private async bindPlaylistMessage(cacheKey: string, songIds: string[], uris: string[]): Promise<void> {
    if (songIds.length === 0) return;

    const ref = await this.redisCacheService.get(playlistMessageKey(cacheKey), PlaylistMessageRefSchema);
    if (!ref) return;

    try {
      await this.playlistReconciler.bind({ messageId: ref.messageId, chatId: ref.chatId, sessionId: ref.sessionId, songIds, uris });
    } catch (e) {
      this.logger.warn(`Could not bind the playlist message ${ref.messageId}: ${getErrorMessage(e)}`);
    }
  }
}
