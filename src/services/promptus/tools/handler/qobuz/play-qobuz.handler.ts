import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { QobuzToolsDefinition } from '../../definition/qobuz-tools.definition';
import { QobuzService } from '../../../../qobuz/qobuz.service';
import { QobuzTrack } from '../../../../qobuz/qobuz.interfaces';
import { getTrackArtistName, getTrackDisplayTitle } from '../../../../qobuz/qobuz-track-match.util';
import { qobuzStreamUri } from '../../../../../config/source-uri.util';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../../../mpd-client/requests/AddMpdRequest';
import { AddTagIdMpdRequest } from '../../../../mpd-client/requests/AddTagIdMpdRequest';
import { PlayMpdRequest } from '../../../../mpd-client/requests/PlayMpdRequest';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface PlayQobuzArgs {
  trackIds?: string[];
  albumIds?: string[];
  clearQueue: boolean;
}

/** A track resolved from the catalog, carrying the album title the queue entry should be tagged with. */
type ResolvedTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
};

/**
 * Plays straight out of the Qobuz catalog, for recordings the library never imported.
 *
 * Nothing is written to Mongo on the way: these songs have no document, and inventing one for a
 * track the user asked to hear once would seed the library with entries no importer ever saw. The
 * negentropy pass is the path that attaches a qobuz source, and it only does so for songs that
 * already exist.
 */
export class PlayQobuzHandler implements ToolHandler {
  readonly name = QobuzToolsDefinition.playCommand.name;
  private readonly logger = new Logger('PlayQobuzHandler');

  constructor(
    private readonly qobuzService: QobuzService,
    private readonly mpdClientService: MpdClientService,
    private readonly configService: ConfigService,
  ) {}

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }

  private isPlayQobuzArgs(args: unknown): args is PlayQobuzArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;

    if (typeof record.clearQueue !== 'boolean') {
      return false;
    }

    const tracksOk = record.trackIds === undefined || record.trackIds === null || this.isStringArray(record.trackIds);
    const albumsOk = record.albumIds === undefined || record.albumIds === null || this.isStringArray(record.albumIds);

    return tracksOk && albumsOk;
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isPlayQobuzArgs(args)) {
      return this.reply(
        `Invalid arguments provided to ${this.name}. Expected clearQueue as a boolean, plus trackIds and/or albumIds as arrays of strings.`,
      );
    }

    const albumIds = args.albumIds ?? [];
    const trackIds = args.trackIds ?? [];

    if (albumIds.length === 0 && trackIds.length === 0) {
      return this.reply('Nothing to play: give at least one Qobuz track id or album id.');
    }

    const failures: string[] = [];
    const tracks = await this.resolveTracks(albumIds, trackIds, failures);

    if (tracks.length === 0) {
      return this.reply(`None of those Qobuz ids resolved to a playable track.${this.renderFailures(failures)}`);
    }

    if (args.clearQueue) {
      try {
        await this.mpdClientService.send(new ClearMpdRequest());
      } catch (error) {
        this.logger.error(`Failed to clear the MPD queue: ${getErrorMessage(error)}`);
      }
    }

    const queued: string[] = [];

    for (const track of tracks) {
      try {
        await this.queue(track);
        queued.push(`${track.artist} - ${track.album} - ${track.title}`);
      } catch (error) {
        this.logger.warn(`Could not queue Qobuz track ${track.id}: ${getErrorMessage(error)}`);
        failures.push(`${track.artist} - ${track.title} (queueing failed)`);
      }
    }

    if (queued.length === 0) {
      return this.reply(`Nothing could be queued.${this.renderFailures(failures)}`);
    }

    try {
      await this.mpdClientService.send(new PlayMpdRequest());
      this.logger.log(`Playback started with ${queued.length} Qobuz track(s).`);
    } catch (error) {
      this.logger.error(`Failed to start playback: ${getErrorMessage(error)}`);
    }

    const list = queued.map((entry) => `- ${entry}`).join('\n');

    return this.reply(`Streaming from Qobuz:\n\n${list}${this.renderFailures(failures)}`);
  }

  /** Albums first, so an album queued alongside loose tracks keeps its running order. */
  private async resolveTracks(albumIds: string[], trackIds: string[], failures: string[]): Promise<ResolvedTrack[]> {
    const resolved: ResolvedTrack[] = [];

    for (const albumId of albumIds) {
      try {
        const album = await this.qobuzService.getAlbum(albumId);
        const items = album.tracks?.items ?? [];

        if (items.length === 0) {
          failures.push(`album ${albumId} (${album.title}) holds no track`);
          continue;
        }

        for (const item of items) {
          resolved.push({
            id: item.id.toString(),
            title: getTrackDisplayTitle(item),
            artist: getTrackArtistName(item) || album.artist?.name || '',
            album: album.title,
          });
        }
      } catch (error) {
        this.logger.warn(`Could not read Qobuz album ${albumId}: ${getErrorMessage(error)}`);
        failures.push(`album ${albumId} (${getErrorMessage(error)})`);
      }
    }

    for (const trackId of trackIds) {
      try {
        const track = await this.qobuzService.getTrack(trackId);
        resolved.push(this.toResolved(track));
      } catch (error) {
        this.logger.warn(`Could not read Qobuz track ${trackId}: ${getErrorMessage(error)}`);
        failures.push(`track ${trackId} (${getErrorMessage(error)})`);
      }
    }

    return resolved;
  }

  private toResolved(track: QobuzTrack): ResolvedTrack {
    return {
      id: track.id.toString(),
      title: getTrackDisplayTitle(track),
      artist: getTrackArtistName(track),
      album: track.album?.title ?? '',
    };
  }

  /**
   * The stream carries no tags of its own — the proxy hands MPD an audio body and nothing else — so
   * the queue entry is labelled by hand, exactly as `PlayMusicHandler` does for library songs.
   */
  private async queue(track: ResolvedTrack): Promise<void> {
    const uri = qobuzStreamUri(this.configService, track.id);
    const added = await this.mpdClientService.send(new AddMpdRequest(uri));
    const songId = added.songId;

    if (!songId) {
      throw new Error(`MPD returned no song id when queueing ${uri}`);
    }

    if (track.artist) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Artist', track.artist));
    if (track.title) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Title', track.title));
    if (track.album) await this.mpdClientService.send(new AddTagIdMpdRequest(songId, 'Album', track.album));
  }

  private renderFailures(failures: string[]): string {
    if (failures.length === 0) return '';

    return `\n\nSkipped:\n${failures.map((failure) => `- ${failure}`).join('\n')}`;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
