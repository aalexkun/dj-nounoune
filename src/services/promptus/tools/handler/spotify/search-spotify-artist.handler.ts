import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { SpotifyToolsDefinition } from '../../definition/spotify-tools.definition';
import { SpotifyService } from '../../../../spotify/spotify.service';
import { SpotifyAlbumMatch, SpotifyArtistMatch, SpotifyTrackMatch } from '../../../../spotify/spotify.interfaces';
import { trackBelongsToArtist } from '../../../../spotify/spotify-track-match.util';
import { describeSpotifyError } from '../../../../spotify/spotify-error.util';

interface SearchSpotifyArtistArgs {
  artist_name: string;
  track_title?: string;
}

/** Track hits reported back. More than this is noise the model has to wade through. */
const MAX_TRACKS_REPORTED = 10;

/** Artist hits reported back, so a common name can still be disambiguated. */
const MAX_ARTISTS_REPORTED = 5;

/** Releases listed. A Spotify discography counts singles, so it runs long. */
const MAX_ALBUMS_REPORTED = 40;

/**
 * The Spotify counterpart of `qobuz_search_artist`: who the artist is and what they have released,
 * for the case where Qobuz had no artist of that name.
 *
 * Same stance on the dead end as the Qobuz handler: an empty answer is reported as an answer, worded
 * to stop the model retrying spellings — with the one difference that there is still a rung below
 * this one, so the wording points at YouTube rather than at nothing.
 */
export class SearchSpotifyArtistHandler implements ToolHandler {
  readonly name = SpotifyToolsDefinition.searchArtistCommand.name;
  private readonly logger = new Logger('SearchSpotifyArtistHandler');

  constructor(private readonly spotifyService: SpotifyService) {}

  private isSearchArgs(args: unknown): args is SearchSpotifyArtistArgs {
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
      const artists = await this.spotifyService.searchArtists(artistName, MAX_ARTISTS_REPORTED);

      if (artists.length === 0) {
        return this.reply(
          `No artist named "${artistName}" exists in the Spotify catalog either. Do not search Spotify again with another spelling. ` +
            'The one step left is youtube_search_music, once, with the same name — and if that is empty too, tell the user the artist is on none of the three and stop.',
        );
      }

      const best = artists[0];
      const sections: string[] = [this.renderArtists(artists)];

      const albums = await this.spotifyService.getArtistAlbums(best.id);
      sections.push(this.renderAlbums(best, albums));

      if (trackTitle) {
        // Ranked against the artist, then verified by id: nothing that is not theirs is listed
        // under their name.
        const tracks = (await this.spotifyService.searchTracks({ title: trackTitle, artist: best.name })).filter((track) =>
          trackBelongsToArtist(track.track, best),
        );

        sections.push(this.renderTracks(trackTitle, best, tracks));
      }

      return this.reply(sections.join('\n\n'));
    } catch (error) {
      const message = `Spotify artist lookup failed for "${artistName}": ${describeSpotifyError(error)}`;
      this.logger.error(message);
      return this.reply(`${message} This is not the same as finding nothing — tell the user the Spotify search could not be run.`);
    }
  }

  private renderArtists(artists: SpotifyArtistMatch[]): string {
    const rows = artists.map((artist) => `${artist.id}|${artist.name}|${artist.genres.slice(0, 3).join(', ')}`).join('\n');

    return `# ARTISTS (Spotify, best match first)\nspotifyArtistId|name|genres\n${rows}`;
  }

  private renderAlbums(artist: SpotifyArtistMatch, albums: SpotifyAlbumMatch[]): string {
    if (albums.length === 0) {
      return `# RELEASES (${artist.name})\nNone reported by Spotify for this artist.`;
    }

    const rows = albums
      .slice(0, MAX_ALBUMS_REPORTED)
      .map((album) => `${album.id}|${album.title}|${album.type}|${album.releaseDate?.slice(0, 4) ?? ''}|${album.trackCount ?? ''}`)
      .join('\n');

    const more = albums.length > MAX_ALBUMS_REPORTED ? `\n… and ${albums.length - MAX_ALBUMS_REPORTED} more` : '';

    return `# RELEASES (${artist.name})\nspotifyAlbumId|title|type|year|tracks\n${rows}${more}`;
  }

  private renderTracks(trackTitle: string, artist: SpotifyArtistMatch, tracks: SpotifyTrackMatch[]): string {
    if (tracks.length === 0) {
      return (
        `# TRACKS ("${trackTitle}" by ${artist.name})\n` +
        `${artist.name} has no recording of that title in the Spotify catalog. Do not search Spotify again: ` +
        'youtube_search_music, once, is the only search left — and if that is empty too, say it is on none of the three and stop.'
      );
    }

    const rows = tracks
      .slice(0, MAX_TRACKS_REPORTED)
      .map((track) => `${track.id}|${track.title}|${track.artist}|${track.album}|${track.score.total.toFixed(2)}`)
      .join('\n');

    return `# TRACKS ("${trackTitle}", Spotify, best match first)\nspotifyTrackId|title|artist|album|matchScore\n${rows}`;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
