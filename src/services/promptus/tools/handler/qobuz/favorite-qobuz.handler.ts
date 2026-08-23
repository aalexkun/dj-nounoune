import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { QobuzToolsDefinition } from '../../definition/qobuz-tools.definition';
import { QobuzService } from '../../../../qobuz/qobuz.service';
import { getTrackDisplayTitle } from '../../../../qobuz/qobuz-track-match.util';
import { getErrorMessage } from '../../../../../utils/error.utils';

/** What the user meant to keep. See {@link FavoriteQobuzHandler} for why `album` is the default. */
type FavoriteScope = 'album' | 'track';

interface FavoriteQobuzArgs {
  scope?: FavoriteScope;
  trackIds?: string[];
  albumIds?: string[];
}

/** One thing about to be favourited, named so the confirmation says what was saved. */
type FavoriteTarget = {
  id: string;
  label: string;
};

/**
 * Adds to the Qobuz favourites.
 *
 * **Albums are the default.** "Save this", "I like this one", "keep that" almost always means the
 * record, even when said over a playing track — people collect albums, not singles. So a track id
 * arriving under `scope: 'album'` is not favourited as a track: the album holding it is looked up
 * and that is what gets saved. Only an explicit "just this song" reaches the track path.
 *
 * This also covers the common gap in the ids to hand: `current_song` can only report a
 * `qobuzAlbumId` when the album document carries a qobuz source, while `qobuzTrackId` is there
 * whenever a Qobuz stream is playing. Resolving album-from-track through the catalog means the
 * usual case works off the id that is actually available.
 */
export class FavoriteQobuzHandler implements ToolHandler {
  readonly name = QobuzToolsDefinition.favoriteCommand.name;
  private readonly logger = new Logger('FavoriteQobuzHandler');

  constructor(private readonly qobuzService: QobuzService) {}

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }

  private isFavoriteArgs(args: unknown): args is FavoriteQobuzArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;
    const scopeOk = record.scope === undefined || record.scope === null || record.scope === 'album' || record.scope === 'track';
    const tracksOk = record.trackIds === undefined || record.trackIds === null || this.isStringArray(record.trackIds);
    const albumsOk = record.albumIds === undefined || record.albumIds === null || this.isStringArray(record.albumIds);

    return scopeOk && tracksOk && albumsOk;
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isFavoriteArgs(args)) {
      return this.reply(
        `Invalid arguments provided to ${this.name}. Expected scope as "album" or "track", plus trackIds and/or albumIds as arrays of strings.`,
      );
    }

    const trackIds = args.trackIds ?? [];
    const albumIds = args.albumIds ?? [];

    // A model that omits the scope gets the answer that is right nine times out of ten.
    const scope: FavoriteScope = args.scope ?? 'album';

    if (trackIds.length === 0 && albumIds.length === 0) {
      return this.reply(
        'Nothing to favourite: give at least one Qobuz track id or album id. Only music carrying a Qobuz id can be favourited — a local file cannot.',
      );
    }

    try {
      return scope === 'track' ? await this.favoriteTracks(trackIds, albumIds) : await this.favoriteAlbums(albumIds, trackIds);
    } catch (error) {
      const message = `Could not add to the Qobuz favourites: ${getErrorMessage(error)}`;
      this.logger.error(message);
      return this.reply(message);
    }
  }

  /** The usual path: whatever was pointed at, saved as the album it belongs to. */
  private async favoriteAlbums(albumIds: string[], trackIds: string[]): Promise<FunctionCallResult> {
    const failures: string[] = [];
    const targets = new Map<string, FavoriteTarget>();

    for (const albumId of albumIds) {
      targets.set(albumId, { id: albumId, label: await this.albumLabel(albumId) });
    }

    for (const trackId of trackIds) {
      const resolved = await this.albumOfTrack(trackId, failures);

      // A track already covered by an album id given outright must not be counted twice.
      if (resolved && !targets.has(resolved.id)) {
        targets.set(resolved.id, resolved);
      }
    }

    if (targets.size === 0) {
      return this.reply(`Could not work out which album to favourite.${this.renderFailures(failures)}`);
    }

    await this.qobuzService.addFavorites({ albumIds: [...targets.keys()] });

    const saved = [...targets.values()].map((target) => `- ${target.label}`).join('\n');
    this.logger.log(`Added ${targets.size} album(s) to the Qobuz favourites.`);

    return this.reply(`Added to the Qobuz favourites, as albums:\n\n${saved}${this.renderFailures(failures)}`);
  }

  /** Only when the user singled the recording out. */
  private async favoriteTracks(trackIds: string[], albumIds: string[]): Promise<FunctionCallResult> {
    if (trackIds.length === 0) {
      return this.reply(
        'Scope is "track" but no track id was given — an album id cannot be favourited as a track. ' +
          'Either pass the track ids, or call again with scope "album" to save the record instead.',
      );
    }

    if (albumIds.length > 0) {
      this.logger.debug(`Ignoring ${albumIds.length} album id(s): the scope is "track"`);
    }

    const failures: string[] = [];
    const targets: FavoriteTarget[] = [];

    for (const trackId of trackIds) {
      targets.push({ id: trackId, label: await this.trackLabel(trackId) });
    }

    await this.qobuzService.addFavorites({ trackIds: targets.map((target) => target.id) });

    const saved = targets.map((target) => `- ${target.label}`).join('\n');
    this.logger.log(`Added ${targets.length} track(s) to the Qobuz favourites.`);

    return this.reply(`Added to the Qobuz favourites, as individual tracks:\n\n${saved}${this.renderFailures(failures)}`);
  }

  /** The album a track sits on. Qobuz already ships it with the track, so this is one call. */
  private async albumOfTrack(trackId: string, failures: string[]): Promise<FavoriteTarget | null> {
    try {
      const track = await this.qobuzService.getTrack(trackId);
      const album = track.album;

      if (!album?.id) {
        failures.push(`track ${trackId} (${track.title}) reports no album, so there is nothing to save as one`);
        return null;
      }

      return { id: album.id, label: `${album.title} — ${album.artist?.name ?? ''}`.trim() };
    } catch (error) {
      this.logger.warn(`Could not resolve the album of Qobuz track ${trackId}: ${getErrorMessage(error)}`);
      failures.push(`track ${trackId} (${getErrorMessage(error)})`);
      return null;
    }
  }

  /**
   * Names are looked up so the confirmation says what was saved rather than an id — favouriting the
   * wrong record is only obvious if the user is told which one it was. Best-effort: a failed lookup
   * falls back to the id and never stops the favourite itself.
   */
  private async albumLabel(albumId: string): Promise<string> {
    try {
      const album = await this.qobuzService.getAlbum(albumId);
      return `${album.title} — ${album.artist?.name ?? ''}`.trim();
    } catch (error) {
      this.logger.debug(`Could not name Qobuz album ${albumId}: ${getErrorMessage(error)}`);
      return `album ${albumId}`;
    }
  }

  private async trackLabel(trackId: string): Promise<string> {
    try {
      const track = await this.qobuzService.getTrack(trackId);
      return `${getTrackDisplayTitle(track)} — ${track.album?.title ?? ''}`.trim();
    } catch (error) {
      this.logger.debug(`Could not name Qobuz track ${trackId}: ${getErrorMessage(error)}`);
      return `track ${trackId}`;
    }
  }

  private renderFailures(failures: string[]): string {
    if (failures.length === 0) return '';

    return `\n\nSkipped:\n${failures.map((failure) => `- ${failure}`).join('\n')}`;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
