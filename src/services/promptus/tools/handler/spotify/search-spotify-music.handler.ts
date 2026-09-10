import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { SpotifyToolsDefinition } from '../../definition/spotify-tools.definition';
import { SpotifyService } from '../../../../spotify/spotify.service';
import { SpotifyArtistCatalogResult, SpotifyArtistMatch, SpotifyTrackMatch } from '../../../../spotify/spotify.interfaces';
import { describeSpotifyError } from '../../../../spotify/spotify-error.util';

interface SearchSpotifyMusicArgs {
  artist_name?: string;
  track_title?: string;
  album_title?: string;
}

/** Tracks reported back. A long record fits; a boxset is truncated rather than dumped. */
const MAX_TRACKS_REPORTED = 40;

/** Loose hits reported when no artist anchored the search. */
const MAX_LOOSE_TRACKS_REPORTED = 8;

/** Namesakes listed when the lookup had to choose between artists of the same name. */
const MAX_CANDIDATES_REPORTED = 4;

/** Releases listed when the album asked for was not in the discography. */
const MAX_ALBUMS_REPORTED = 30;

/**
 * The second attempt: what Spotify has when Qobuz had nothing.
 *
 * With an artist named it is the artist-locked lookup `qobuz_find_artist_track` is on the Qobuz
 * side — the name is resolved to a Spotify id first and every hit is verified against it, so it
 * cannot answer with somebody else's cover. Without one it is the ranked catalog search.
 *
 * Every reply that finds nothing is worded as a hand-off rather than an ending: there is still
 * one rung below this one, and the model has to be told that it is exactly one.
 */
export class SearchSpotifyMusicHandler implements ToolHandler {
  readonly name = SpotifyToolsDefinition.searchMusicCommand.name;
  private readonly logger = new Logger('SearchSpotifyMusicHandler');

  constructor(private readonly spotifyService: SpotifyService) {}

  private isSearchArgs(args: unknown): args is SearchSpotifyMusicArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;
    const optionalString = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string';

    return optionalString(record.artist_name) && optionalString(record.track_title) && optionalString(record.album_title);
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isSearchArgs(args)) {
      return this.reply('Invalid arguments: artist_name, track_title and album_title must all be strings when given.');
    }

    const artist = args.artist_name?.trim() ?? '';
    const title = args.track_title?.trim() ?? '';
    const album = args.album_title?.trim() ?? '';

    if (!artist && !title && !album) {
      return this.reply('Nothing to search for: give at least an artist, a song title or an album title.');
    }

    try {
      if (artist) {
        return this.reply(await this.searchLockedToArtist(artist, album, title));
      }

      if (!title) {
        // An album with no artist has nothing to anchor on. The model almost always knows the
        // artist; asking for it is cheaper than guessing among every record of that name.
        return this.reply(
          `Give artist_name alongside "${album}": a record is looked up in its artist's discography, and without the artist there is nothing to lock it to.`,
        );
      }

      return this.reply(await this.searchLoose(title, album));
    } catch (error) {
      // A missing session or a rate limit arrives here, and it is worth separating: nothing about
      // the request was wrong, and the model must not read the failure as "this music does not exist".
      const message = `The Spotify search failed: ${describeSpotifyError(error)}`;
      this.logger.error(message);

      return this.reply(
        `${message} This is not the same as finding nothing — tell the user the Spotify search could not be run, ` +
          'then try youtube_search_music once.',
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Artist route — locked to a Spotify artist id                       */
  /* ------------------------------------------------------------------ */

  private async searchLockedToArtist(artistName: string, albumTitle: string, trackTitle: string): Promise<string> {
    const result = await this.spotifyService.searchArtistCatalog({
      artist: artistName,
      album: albumTitle || undefined,
      title: trackTitle || undefined,
    });

    if (!result.artist) {
      return this.handOff(`No artist named "${artistName}" exists in the Spotify catalog either.`);
    }

    const artist = result.artist;
    const sections: string[] = [this.renderArtist(artist, result.candidates, artistName)];

    if (albumTitle && !result.matchedAlbum) {
      sections.push(
        `# ALBUM ("${albumTitle}")\n` +
          `${artist.name} has no release by that name on Spotify. Their releases are listed below; if one of them is what the user meant, ask before playing it. ` +
          'Otherwise the record may still be on YouTube: youtube_search_music, once, is the only search left.',
      );
      sections.push(this.renderAlbums(artist, result));

      return sections.join('\n\n');
    }

    if (result.matchedAlbum) {
      const matched = result.matchedAlbum;
      sections.push(
        `# ALBUM (Spotify)\nspotifyAlbumId|title|type|year|tracks\n${matched.id}|${matched.title}|${matched.type}|${matched.releaseDate?.slice(0, 4) ?? ''}|${matched.trackCount ?? ''}`,
      );
    }

    sections.push(this.renderTracks(result, albumTitle, trackTitle));

    if (!result.matchedAlbum && !trackTitle) {
      sections.push(this.renderAlbums(artist, result));
    }

    return sections.join('\n\n');
  }

  private renderArtist(artist: SpotifyArtistMatch, candidates: SpotifyArtistMatch[], asked: string): string {
    const others = candidates.filter((candidate) => candidate.id !== artist.id).slice(0, MAX_CANDIDATES_REPORTED);

    let section = `# ARTIST (Spotify — everything below is verified to be theirs)\nspotifyArtistId|name|genres\n${artist.id}|${artist.name}|${artist.genres.slice(0, 3).join(', ')}`;

    if (others.length > 0) {
      section +=
        `\n\nOther artists whose name also matched "${asked}", NOT included in the results below:\n` +
        others.map((candidate) => `${candidate.id}|${candidate.name}|${candidate.genres.slice(0, 3).join(', ')}`).join('\n');
    }

    return section;
  }

  private renderAlbums(artist: SpotifyArtistMatch, result: SpotifyArtistCatalogResult): string {
    if (result.albums.length === 0) {
      return `# RELEASES (${artist.name})\nNone reported by Spotify for this artist.`;
    }

    const rows = result.albums
      .slice(0, MAX_ALBUMS_REPORTED)
      .map((album) => `${album.id}|${album.title}|${album.type}|${album.releaseDate?.slice(0, 4) ?? ''}|${album.trackCount ?? ''}`)
      .join('\n');

    const more = result.albums.length > MAX_ALBUMS_REPORTED ? `\n… and ${result.albums.length - MAX_ALBUMS_REPORTED} more` : '';

    return `# RELEASES (${artist.name})\nspotifyAlbumId|title|type|year|tracks\n${rows}${more}`;
  }

  private renderTracks(result: SpotifyArtistCatalogResult, albumTitle: string, trackTitle: string): string {
    const artist = result.artist!;
    const asked = [trackTitle && `"${trackTitle}"`, albumTitle && `on "${albumTitle}"`].filter(Boolean).join(' ');

    if (result.tracks.length === 0) {
      if (!trackTitle && !albumTitle) {
        return `# TRACKS\nNothing was asked for beyond the artist. Pick a record from the releases below and play it by its album id with spotify_start_playback.`;
      }

      return this.handOff(`${artist.name} has no such recording (${asked}) in the Spotify catalog.`, '# TRACKS');
    }

    const rows = result.tracks
      .slice(0, MAX_TRACKS_REPORTED)
      .map((track) => this.renderTrackRow(track, result.source === 'album'))
      .join('\n');

    // An album tracklist is exact, so a match score on it would be meaningless noise; a catalog
    // hit was still fuzzy-matched on the title and the score says how far to trust it.
    const header =
      result.source === 'album'
        ? `# TRACKS (${artist.name} — read from the album itself, in running order)\nspotifyTrackId|no|title|duration`
        : `# TRACKS (${asked} by ${artist.name}, Spotify, best match first)\nspotifyTrackId|title|album|duration|titleMatch`;

    const more = result.tracks.length > MAX_TRACKS_REPORTED ? `\n… and ${result.tracks.length - MAX_TRACKS_REPORTED} more` : '';

    return `${header}\n${rows}${more}\n\nPlay them with spotify_start_playback and tell the user it is streaming from Spotify.`;
  }

  private renderTrackRow(track: SpotifyTrackMatch, fromAlbum: boolean): string {
    const duration = this.formatDuration(track.duration);

    if (fromAlbum) {
      return `${track.id}|${track.track.track_number ?? ''}|${track.title}|${duration}`;
    }

    return `${track.id}|${track.title}|${track.album}|${duration}|${track.score.title.toFixed(2)}`;
  }

  /* ------------------------------------------------------------------ */
  /* Loose route — no artist to lock to                                 */
  /* ------------------------------------------------------------------ */

  private async searchLoose(title: string, album: string): Promise<string> {
    const matches = await this.spotifyService.searchTracks({ title, album: album || undefined });

    this.logger.log(`Spotify search for "${title}"${album ? ` on "${album}"` : ''}: ${matches.length} plausible hit(s)`);

    if (matches.length === 0) {
      return this.handOff(`Nothing on Spotify is a recording of "${title}"${album ? ` on "${album}"` : ''}.`);
    }

    const rows = matches
      .slice(0, MAX_LOOSE_TRACKS_REPORTED)
      .map(
        (match) => `${match.id}|${match.title}|${match.artist}|${match.album}|${this.formatDuration(match.duration)}|${match.score.total.toFixed(2)}`,
      )
      .join('\n');

    return (
      '# TRACKS (Spotify, best match first — no artist was given, so these are ranked, not verified)\n' +
      'spotifyTrackId|title|artist|album|duration|match\n' +
      `${rows}\n\n` +
      'Play the top one with spotify_start_playback unless its artist is plainly not who the user meant; if you know the artist, search again with artist_name to be sure.'
    );
  }

  private formatDuration(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
  }

  /**
   * The wording that hands the search down one rung.
   *
   * Spotify is the middle of the ladder: an empty answer here means YouTube, once, and then the
   * end — and it has to say so, or the loop either stops early or keeps re-spelling.
   */
  private handOff(what: string, heading?: string): string {
    const body =
      `${what} Qobuz did not have it either. Do not search Spotify again with another spelling. ` +
      'youtube_search_music, once, with the same artist, song and album, is the only search left — and if that is empty too, tell the user the music is on none of the three and stop.';

    return heading ? `${heading}\n${body}` : body;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
