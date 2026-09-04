import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { QobuzToolsDefinition } from '../../definition/qobuz-tools.definition';
import { QobuzService } from '../../../../qobuz/qobuz.service';
import { QobuzArtistCatalogResult, QobuzArtistMatch, QobuzTrackMatch } from '../../../../qobuz/qobuz.interfaces';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface FindArtistTrackArgs {
  artist_name: string;
  album_title?: string;
  track_title?: string;
}

/** Tracks reported back. A long record fits; a boxset is truncated rather than dumped. */
const MAX_TRACKS_REPORTED = 40;

/** Namesakes listed when the lookup had to choose between artists of the same name. */
const MAX_CANDIDATES_REPORTED = 4;

/**
 * The artist-locked half of the Qobuz lookup pair.
 *
 * `qobuz_search_artist` answers "who is this and what have they made"; this one answers "find me
 * *this* record of theirs", and the difference that matters is that it cannot answer with anybody
 * else's. `QobuzService.searchArtistCatalog` resolves the name to a Qobuz artist id before it looks
 * for anything, so a dead end here is reported as a dead end instead of as a stranger's recording
 * of the same title — which is exactly what the free-text catalog search used to do.
 */
export class FindQobuzArtistTrackHandler implements ToolHandler {
  readonly name = QobuzToolsDefinition.findArtistTrackCommand.name;
  private readonly logger = new Logger('FindQobuzArtistTrackHandler');

  constructor(private readonly qobuzService: QobuzService) {}

  private isFindArgs(args: unknown): args is FindArtistTrackArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;
    const optionalString = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string';

    return (
      typeof record.artist_name === 'string' &&
      record.artist_name.trim().length > 0 &&
      optionalString(record.album_title) &&
      optionalString(record.track_title)
    );
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isFindArgs(args)) {
      return this.reply('Invalid arguments: artist_name must be a non-empty string.');
    }

    const artistName = args.artist_name.trim();
    const albumTitle = args.album_title?.trim();
    const trackTitle = args.track_title?.trim();

    try {
      const result = await this.qobuzService.searchArtistCatalog({
        artist: artistName,
        album: albumTitle,
        title: trackTitle,
      });

      if (!result.artist) {
        // Final, and worded to stay final: the thinking loop otherwise spends its ten iterations
        // trying spellings of a name the catalog does not have.
        return this.reply(
          `No artist named "${artistName}" exists in the Qobuz catalog. Do not search Qobuz again with another spelling. ` +
            'The one thing left to try is youtube_search_music, once, with the same name — and if that is empty too, tell the user the artist is on neither and stop.',
        );
      }

      return this.reply(this.render(result, artistName, albumTitle, trackTitle));
    } catch (error) {
      const message = `Qobuz artist-locked lookup failed for "${artistName}": ${getErrorMessage(error)}`;
      this.logger.error(message);
      return this.reply(message);
    }
  }

  private render(result: QobuzArtistCatalogResult, artistName: string, albumTitle: string | undefined, trackTitle: string | undefined): string {
    const artist = result.artist!;
    const sections: string[] = [this.renderArtist(artist, result.candidates, artistName)];

    if (albumTitle && !result.matchedAlbum) {
      sections.push(
        `# ALBUM ("${albumTitle}")\n` +
          `${artist.name} has no album by that name in the Qobuz catalog. Their releases are listed below; if one of them is what the user meant, ask before playing it. ` +
          'Otherwise the record may still be on YouTube: youtube_search_music, once, is the only search left.',
      );
      sections.push(this.renderAlbums(artist, result));

      return sections.join('\n\n');
    }

    if (result.matchedAlbum) {
      const matched = result.matchedAlbum;
      const title = matched.version ? `${matched.title} (${matched.version})` : matched.title;
      sections.push(
        `# ALBUM\nqobuzAlbumId|title|year|tracks\n${matched.id}|${title}|${matched.release_date_original?.slice(0, 4) ?? ''}|${matched.tracks_count ?? ''}`,
      );
    }

    sections.push(this.renderTracks(result, albumTitle, trackTitle));

    if (!result.matchedAlbum) {
      sections.push(this.renderAlbums(artist, result));
    }

    return sections.join('\n\n');
  }

  private renderArtist(artist: QobuzArtistMatch, candidates: QobuzArtistMatch[], asked: string): string {
    const rows = [`${artist.id}|${artist.name}|${artist.albumsCount ?? ''}`];
    const others = candidates.filter((candidate) => candidate.id !== artist.id).slice(0, MAX_CANDIDATES_REPORTED);

    let section = `# ARTIST (everything below is verified to be theirs)\nqobuzArtistId|name|albums\n${rows.join('\n')}`;

    if (others.length > 0) {
      section +=
        `\n\nOther artists whose name also matched "${asked}", NOT included in the results below:\n` +
        others.map((candidate) => `${candidate.id}|${candidate.name}|${candidate.albumsCount ?? ''}`).join('\n');
    }

    return section;
  }

  private renderAlbums(artist: QobuzArtistMatch, result: QobuzArtistCatalogResult): string {
    if (result.albums.length === 0) {
      return `# DISCOGRAPHY (${artist.name})\nNone reported by Qobuz for this artist.`;
    }

    const rows = result.albums
      .map((album) => {
        const title = album.version ? `${album.title} (${album.version})` : album.title;
        return `${album.id}|${title}|${album.release_date_original?.slice(0, 4) ?? ''}|${album.tracks_count ?? ''}|${album.hires ? 'hi-res' : ''}`;
      })
      .join('\n');

    return `# DISCOGRAPHY (${artist.name})\nqobuzAlbumId|title|year|tracks|quality\n${rows}`;
  }

  private renderTracks(result: QobuzArtistCatalogResult, albumTitle: string | undefined, trackTitle: string | undefined): string {
    const artist = result.artist!;
    const asked = [trackTitle && `"${trackTitle}"`, albumTitle && `on "${albumTitle}"`].filter(Boolean).join(' ');

    if (result.tracks.length === 0) {
      if (!trackTitle && !albumTitle) {
        return `# TRACKS\nNothing was asked for beyond the artist. Pick a record from the discography below and play it by its album id.`;
      }

      return (
        `# TRACKS (${asked} by ${artist.name})\n` +
        `${artist.name} has no such recording in the Qobuz catalog. ` +
        'Do not fall back to a plain Qobuz catalog search: any hit it produced would be a different performer. ' +
        'youtube_search_music, once, is the only search left — and if that is empty too, say it is on neither and stop.'
      );
    }

    const rows = result.tracks
      .slice(0, MAX_TRACKS_REPORTED)
      .map((track) => this.renderTrackRow(track, result.source === 'album'))
      .join('\n');

    // An album tracklist is exact, so a match score on it would be meaningless noise; a catalog
    // hit was still fuzzy-matched on the title and the score says how far to trust it.
    const header =
      result.source === 'album'
        ? `# TRACKS (${artist.name} — read from the album itself, in running order)\nqobuzTrackId|no|title|duration|quality`
        : `# TRACKS (${asked} by ${artist.name}, best match first)\nqobuzTrackId|title|album|duration|titleMatch`;

    const more = result.tracks.length > MAX_TRACKS_REPORTED ? `\n… and ${result.tracks.length - MAX_TRACKS_REPORTED} more` : '';

    return `${header}\n${rows}${more}`;
  }

  private renderTrackRow(track: QobuzTrackMatch, fromAlbum: boolean): string {
    const title = track.version ? `${track.title} (${track.version})` : track.title;
    const duration = `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}`;

    if (fromAlbum) {
      return `${track.id}|${track.track.track_number ?? ''}|${title}|${duration}|${track.hires ? 'hi-res' : 'cd'}`;
    }

    return `${track.id}|${title}|${track.album}|${duration}|${track.score.title.toFixed(2)}`;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
