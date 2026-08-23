import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { QobuzToolsDefinition } from '../../definition/qobuz-tools.definition';
import { QobuzService } from '../../../../qobuz/qobuz.service';
import { QobuzArtistAlbum, QobuzArtistMatch, QobuzTrackMatch } from '../../../../qobuz/qobuz.interfaces';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface SearchQobuzArtistArgs {
  artist_name: string;
  track_title?: string;
}

/** Track hits reported back. More than this is noise the model has to wade through. */
const MAX_TRACKS_REPORTED = 10;

/** Artist hits reported back, so a common name can still be disambiguated. */
const MAX_ARTISTS_REPORTED = 5;

export class SearchQobuzArtistHandler implements ToolHandler {
  readonly name = QobuzToolsDefinition.searchArtistCommand.name;
  private readonly logger = new Logger('SearchQobuzArtistHandler');

  constructor(private readonly qobuzService: QobuzService) {}

  private isSearchArgs(args: unknown): args is SearchQobuzArtistArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;

    return (
      typeof record.artist_name === 'string' &&
      record.artist_name.trim().length > 0 &&
      (record.track_title === undefined || record.track_title === null || typeof record.track_title === 'string')
    );
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isSearchArgs(args)) {
      return this.reply('Invalid arguments: artist_name must be a non-empty string.');
    }

    const artistName = args.artist_name.trim();
    const trackTitle = args.track_title?.trim();

    try {
      const artists = await this.qobuzService.searchArtists(artistName, MAX_ARTISTS_REPORTED);

      // The dead end is reported as an answer rather than an error, so the model stops here instead
      // of retrying the catalog with a different spelling until the thinking loop runs out.
      if (artists.length === 0) {
        return this.reply(
          `No artist named "${artistName}" exists in the Qobuz catalog. This is final — the search stops here. ` +
            'Do not search again with another spelling and do not try another tool: tell the user this artist is not available on Qobuz.',
        );
      }

      const best = artists[0];
      const sections: string[] = [this.renderArtists(artists)];

      const albums = await this.qobuzService.getArtistAlbums(best.id);
      sections.push(this.renderAlbums(best, albums));

      if (trackTitle) {
        const tracks = await this.qobuzService.searchTracks({ title: trackTitle, artist: best.name });
        sections.push(this.renderTracks(trackTitle, best, tracks));
      }

      return this.reply(sections.join('\n\n'));
    } catch (error) {
      const message = `Qobuz artist lookup failed for "${artistName}": ${getErrorMessage(error)}`;
      this.logger.error(message);
      return this.reply(message);
    }
  }

  private renderArtists(artists: QobuzArtistMatch[]): string {
    const rows = artists
      .map((artist) => `${artist.id}|${artist.name}|${artist.albumsCount ?? ''}`)
      .join('\n');

    return `# ARTISTS (best match first)\nqobuzArtistId|name|albums\n${rows}`;
  }

  private renderAlbums(artist: QobuzArtistMatch, albums: QobuzArtistAlbum[]): string {
    if (albums.length === 0) {
      return `# ALBUMS (${artist.name})\nNone reported by Qobuz for this artist.`;
    }

    const rows = albums
      .map((album) => {
        const title = album.version ? `${album.title} (${album.version})` : album.title;
        return `${album.id}|${title}|${album.release_date_original?.slice(0, 4) ?? ''}|${album.tracks_count ?? ''}|${album.hires ? 'hi-res' : ''}`;
      })
      .join('\n');

    return `# ALBUMS (${artist.name})\nqobuzAlbumId|title|year|tracks|quality\n${rows}`;
  }

  private renderTracks(trackTitle: string, artist: QobuzArtistMatch, tracks: QobuzTrackMatch[]): string {
    if (tracks.length === 0) {
      return `# TRACKS ("${trackTitle}" by ${artist.name})\nNo recording of that title in the Qobuz catalog. Do not search again — report it and stop.`;
    }

    const rows = tracks
      .slice(0, MAX_TRACKS_REPORTED)
      .map((track) => {
        const title = track.version ? `${track.title} (${track.version})` : track.title;
        return `${track.id}|${title}|${track.artist}|${track.album}|${track.score.total.toFixed(2)}`;
      })
      .join('\n');

    return `# TRACKS ("${trackTitle}", best match first)\nqobuzTrackId|title|artist|album|matchScore\n${rows}`;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
