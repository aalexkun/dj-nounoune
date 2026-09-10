import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { SpotifyToolsDefinition } from '../../definition/spotify-tools.definition';
import { SpotifyService } from '../../../../spotify/spotify.service';
import { getTrackArtistName } from '../../../../spotify/spotify-track-match.util';
import { describeSpotifyError } from '../../../../spotify/spotify-error.util';
import { spotifyStreamUri } from '../../../../../config/source-uri.util';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../../../mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../../../mpd-client/requests/AddMpdRequest';
import { AddTagIdMpdRequest } from '../../../../mpd-client/requests/AddTagIdMpdRequest';
import { PlayMpdRequest } from '../../../../mpd-client/requests/PlayMpdRequest';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface PlaySpotifyArgs {
  trackIds?: string[];
  albumIds?: string[];
  clearQueue: boolean;
}

/** A track resolved from the catalog, carrying what the queue entry should be tagged with. */
type ResolvedTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
};

/**
 * Plays straight out of the Spotify catalog, for recordings the library never imported.
 *
 * Same stance as `PlayQobuzHandler`, for the same reason: nothing is written to Mongo. These
 * songs have no document, and inventing one for a track the user asked to hear once would seed
 * the library with entries no importer ever saw. The negentropy pass is the path that attaches a
 * spotify source, and only to songs that already exist.
 */
export class PlaySpotifyHandler implements ToolHandler {
  readonly name = SpotifyToolsDefinition.playCommand.name;
  private readonly logger = new Logger('PlaySpotifyHandler');

  constructor(
    private readonly spotifyService: SpotifyService,
    private readonly mpdClientService: MpdClientService,
    private readonly configService: ConfigService,
  ) {}

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }

  private isPlaySpotifyArgs(args: unknown): args is PlaySpotifyArgs {
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
    if (!this.isPlaySpotifyArgs(args)) {
      return this.reply(
        `Invalid arguments provided to ${this.name}. Expected clearQueue as a boolean, plus trackIds and/or albumIds as arrays of strings.`,
      );
    }

    const albumIds = args.albumIds ?? [];
    const trackIds = args.trackIds ?? [];

    if (albumIds.length === 0 && trackIds.length === 0) {
      return this.reply('Nothing to play: give at least one Spotify track id or album id.');
    }

    const failures: string[] = [];
    const tracks = await this.resolveTracks(albumIds, trackIds, failures);

    if (tracks.length === 0) {
      return this.reply(`None of those Spotify ids resolved to a playable track.${this.renderFailures(failures)}`);
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
        queued.push([track.artist, track.album, track.title].filter(Boolean).join(' - '));
      } catch (error) {
        this.logger.warn(`Could not queue Spotify track ${track.id}: ${getErrorMessage(error)}`);
        failures.push(`${track.artist} - ${track.title} (queueing failed)`);
      }
    }

    if (queued.length === 0) {
      return this.reply(`Nothing could be queued.${this.renderFailures(failures)}`);
    }

    try {
      await this.mpdClientService.send(new PlayMpdRequest());
      this.logger.log(`Playback started with ${queued.length} Spotify track(s).`);
    } catch (error) {
      this.logger.error(`Failed to start playback: ${getErrorMessage(error)}`);
    }

    const list = queued.map((entry) => `- ${entry}`).join('\n');

    return this.reply(
      `Streaming from Spotify:\n\n${list}${this.renderFailures(failures)}\n\nTell the user this is coming from Spotify rather than from their library or from Qobuz.`,
    );
  }

  /** Albums first, so an album queued alongside loose tracks keeps its running order. */
  private async resolveTracks(albumIds: string[], trackIds: string[], failures: string[]): Promise<ResolvedTrack[]> {
    const resolved: ResolvedTrack[] = [];

    for (const albumId of albumIds) {
      try {
        const { album, tracks } = await this.spotifyService.getAlbum(albumId);

        if (tracks.length === 0) {
          failures.push(`album ${albumId} (${album.name}) holds no track`);
          continue;
        }

        for (const item of tracks) {
          resolved.push({
            id: item.id,
            title: item.name,
            artist: item.artists[0]?.name || album.artists[0]?.name || '',
            album: album.name,
          });
        }
      } catch (error) {
        const message = describeSpotifyError(error);
        this.logger.warn(`Could not read Spotify album ${albumId}: ${message}`);
        failures.push(`album ${albumId} (${message})`);
      }
    }

    for (const trackId of trackIds) {
      try {
        const track = await this.spotifyService.getTrack(trackId);
        resolved.push({
          id: track.id,
          title: track.name,
          artist: getTrackArtistName(track),
          album: track.album.name,
        });
      } catch (error) {
        const message = describeSpotifyError(error);
        this.logger.warn(`Could not read Spotify track ${trackId}: ${message}`);
        failures.push(`track ${trackId} (${message})`);
      }
    }

    return resolved;
  }

  /**
   * The stream carries no tags of its own — the proxy hands MPD an audio body and nothing else — so
   * the queue entry is labelled by hand, exactly as the other play handlers do.
   */
  private async queue(track: ResolvedTrack): Promise<void> {
    const uri = spotifyStreamUri(this.configService, track.id);
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
