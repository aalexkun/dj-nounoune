import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { YoutubeToolsDefinition } from '../../definition/youtube-tools.definition';
import { YoutubeService } from '../../../../youtube/youtube.service';
import { YoutubePlaylistMatch, YoutubePlaylistTrack, YoutubeTrackMatch } from '../../../../youtube/youtube.interfaces';
import { normalizeChannelTitle, stripReleasePrefix } from '../../../../youtube/youtube-track-match.util';
import { identitySimilarity, normalizeForMatch, similarity } from '../../../../../utils/text-match.utils';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface SearchYoutubeArgs {
  artist_name?: string;
  track_title?: string;
  album_title?: string;
}

/** One playlist candidate, with the two scores that decide whether it is the record asked for. */
type ScoredPlaylist = {
  playlist: YoutubePlaylistMatch;
  title: number;
  artist: number;
};

/**
 * Total score a video must reach to be reported at all.
 *
 * Lower than the 0.6 `YoutubeService.findTrack` uses, because this is the last place anything is
 * looked for: a marginal hit the user can reject beats a dead end. The artist floor below is what
 * keeps that from turning back into the Qobuz false-positive problem.
 */
const MINIMUM_TRACK_SCORE = 0.5;

/**
 * How much a hit must look like the named artist to be shown under their name.
 *
 * There is no artist entity on YouTube — the artist is parsed out of a free-text upload title, or
 * read off the uploading channel — so this is a judgement where `trackBelongsToArtist` on the
 * Qobuz side is an identity check. It is why this tool is described as unable to promise the
 * recording is really theirs.
 */
const MINIMUM_ARTIST_SCORE = 0.6;

/**
 * How much a hit's title must look like the song asked for.
 *
 * Separate from the total, and the floor that actually matters: the total is one number over
 * title and artist together, so a video from the artist's own channel clears it on the artist
 * alone. That is how a search for Spice's "Bad Behaviour" came back with Spice's "Bad Girl" —
 * artist 1.00, title 0.50, total comfortably above any single threshold. Right artist, wrong song
 * is the exact false positive this fallback exists downstream of, so the two are floored apart.
 */
const MINIMUM_TITLE_SCORE = 0.6;

/** How closely a playlist title must match the album asked for before it is treated as that record. */
const MINIMUM_ALBUM_SCORE = 0.5;

/** YouTube Music's auto-generated release playlists: one per record, right order, no extras. */
const RELEASE_PLAYLIST_PREFIX = 'OLAK5uy_';

/** Preference for a release playlist over a hand-made one of the same name. Small: it breaks ties. */
const RELEASE_PLAYLIST_BONUS = 0.1;

const MAX_TRACKS_REPORTED = 40;
const MAX_ALBUMS_REPORTED = 5;
const MAX_LOOSE_TRACKS_REPORTED = 8;

/**
 * The fallback lookup: what is on YouTube when Qobuz had nothing.
 *
 * Two routes, and which one runs is decided by what the user named rather than by a mode flag. An
 * album goes through the playlist search, because a release playlist is the only YouTube object
 * with album structure — ordered, titled, stable id — and reading a tracklist off one is exact
 * where assembling a record out of loose video hits is not. A song with no album goes through the
 * video search.
 *
 * Every reply that finds nothing is worded as an ending. This tool is the second attempt, so the
 * model reaching an empty answer here has already been told once that Qobuz does not have it;
 * without wording that closes the door the thinking loop spends its remaining iterations
 * re-spelling a name that is simply not anywhere.
 */
export class SearchYoutubeMusicHandler implements ToolHandler {
  readonly name = YoutubeToolsDefinition.searchMusicCommand.name;
  private readonly logger = new Logger('SearchYoutubeMusicHandler');

  constructor(private readonly youtubeService: YoutubeService) {}

  private isSearchArgs(args: unknown): args is SearchYoutubeArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;
    const optionalString = (value: unknown): boolean =>
      value === undefined || value === null || typeof value === 'string';

    return (
      optionalString(record.artist_name) && optionalString(record.track_title) && optionalString(record.album_title)
    );
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
      if (album) {
        const rendered = await this.searchAlbum(artist, album, title);

        if (rendered) {
          return this.reply(rendered);
        }

        // No playlist is that record. Falling through to the artist's other playlists here would
        // answer a question nobody asked, and the next step after that is queueing the wrong album
        // — so unless a song was also named, the search ends.
        if (!title) {
          return this.reply(
            this.deadEnd(`No YouTube playlist is the record "${album}"${artist ? ` by ${artist}` : ''}.`),
          );
        }
      }

      if (title) {
        return this.reply(await this.searchTrack(artist, title, album));
      }

      return this.reply(await this.searchArtistReleases(artist, album));
    } catch (error) {
      // Quota exhaustion arrives here, and it is worth separating: nothing about the request was
      // wrong, and the model must not read the failure as "this music does not exist".
      const message = `The YouTube search failed: ${getErrorMessage(error)}`;
      this.logger.error(message);

      return this.reply(
        `${message} This is not the same as finding nothing — tell the user the YouTube search could not be run, ` +
          'not that the music does not exist.',
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Album route — a release playlist is the record                     */
  /* ------------------------------------------------------------------ */

  /** @returns The rendered answer, or `null` when no playlist looked like that record. */
  private async searchAlbum(artist: string, album: string, title: string): Promise<string | null> {
    const playlists = await this.youtubeService.searchPlaylists([artist, album].filter(Boolean).join(' '));
    const scored = this.scorePlaylists(playlists, artist, album);
    const best = scored[0];

    if (!best || best.title < MINIMUM_ALBUM_SCORE || (artist && best.artist < MINIMUM_ARTIST_SCORE)) {
      this.logger.debug(`No YouTube playlist matched "${album}" by "${artist}" (${playlists.length} candidate(s))`);
      return null;
    }

    const tracks = await this.youtubeService.getPlaylistItems(best.playlist.id, MAX_TRACKS_REPORTED);

    if (tracks.length === 0) {
      return null;
    }

    this.logger.log(
      `YouTube album "${album}" resolved to playlist "${best.playlist.title}" (${best.playlist.id}, ${best.title.toFixed(2)}), ${tracks.length} track(s)`,
    );

    const sections = [
      '# ALBUM (YouTube — matched by name, not against an artist id)\n' +
        'youtubePlaylistId|title|channel|tracks\n' +
        `${best.playlist.id}|${stripReleasePrefix(best.playlist.title)}|${best.playlist.channelTitle ?? ''}|${tracks.length}`,
      this.renderPlaylistTracks(tracks, title),
    ];

    const others = scored.slice(1, MAX_ALBUMS_REPORTED);

    if (others.length > 0) {
      sections.push(
        '# OTHER PLAYLISTS THAT MATCHED THE NAME (not used)\n' +
          'youtubePlaylistId|title|channel\n' +
          others
            .map(
              (entry) =>
                `${entry.playlist.id}|${stripReleasePrefix(entry.playlist.title)}|${entry.playlist.channelTitle ?? ''}`,
            )
            .join('\n'),
      );
    }

    return sections.join('\n\n');
  }

  /**
   * Ranks playlists on their title and their channel, with a nudge towards the auto-generated
   * release playlists — those are one per record and in the right order, where a fan-made playlist
   * of the same name holds whatever somebody felt like putting in it.
   *
   * `identitySimilarity`, not `similarity`: the question here is whether this playlist *is* that
   * record, and the containment branch of the ordinary matcher answers "a title containing both
   * those words" instead. Asked for Spice's "Abbey Road" it scored "2022. The Abbey Medieval
   * Festival. Dancers from the Spice Road" at 0.90 and queued twenty-four minutes of it.
   */
  private scorePlaylists(playlists: YoutubePlaylistMatch[], artist: string, album: string): ScoredPlaylist[] {
    return playlists
      .map((playlist) => {
        const bare = stripReleasePrefix(playlist.title);
        const isRelease = playlist.id.startsWith(RELEASE_PLAYLIST_PREFIX);

        const named = Math.max(
          identitySimilarity(album, bare),
          identitySimilarity(album, this.withoutArtist(bare, artist)),
        );

        return {
          playlist,
          title: Math.min(1, named + (isRelease ? RELEASE_PLAYLIST_BONUS : 0)),
          artist: artist
            ? Math.max(
                identitySimilarity(artist, normalizeChannelTitle(playlist.channelTitle)),
                // A release playlist is owned by YouTube Music, but still names the artist in its
                // own title, so the title is the second place to look for them.
                identitySimilarity(artist, playlist.title),
              )
            : 1,
        };
      })
      .sort((left, right) => right.title + right.artist - (left.title + left.artist));
  }

  /**
   * A playlist title with the artist's own words taken out of it.
   *
   * Playlists are overwhelmingly titled `Artist - Album`, and an identity comparison counts every
   * word: a one-word record against `Anderson Paak - Malibu` scores 0.50 on the artist's name
   * alone, which is the floor rather than the confident match it plainly is. Removing them is done
   * token by token because the two spellings rarely agree — `Anderson .Paak` against
   * `Anderson Paak` defeats any literal replace.
   *
   * A record actually named after its artist would strip to nothing, so an empty result falls back
   * to the untouched title.
   */
  private withoutArtist(title: string, artist: string): string {
    if (!artist) {
      return title;
    }

    const artistTokens = new Set(normalizeForMatch(artist).split(' ').filter(Boolean));
    const kept = normalizeForMatch(title)
      .split(' ')
      .filter((token) => token && !artistTokens.has(token));

    return kept.length > 0 ? kept.join(' ') : title;
  }

  private renderPlaylistTracks(tracks: YoutubePlaylistTrack[], title: string): string {
    const wanted = title ? tracks.filter((track) => similarity(title, track.title) >= MINIMUM_TITLE_SCORE) : [];
    const shown = wanted.length > 0 ? wanted : tracks;

    const header = title
      ? wanted.length > 0
        ? `# TRACKS ("${title}" on that record)`
        : `# TRACKS (nothing on that record is called "${title}" — here is the whole thing, in running order)`
      : '# TRACKS (read from the playlist itself, in running order)';

    const rows = shown
      .map((track) => `${track.videoId}|${track.trackNumber}|${track.title}|${track.artist || track.channelTitle || ''}`)
      .join('\n');

    return `${header}\nyoutubeVideoId|no|title|artist\n${rows}`;
  }

  /* ------------------------------------------------------------------ */
  /* Track route — loose videos                                         */
  /* ------------------------------------------------------------------ */

  private async searchTrack(artist: string, title: string, album: string): Promise<string> {
    const matches = await this.youtubeService.searchTracks({
      title,
      artist: artist || undefined,
      album: album || undefined,
    });

    const kept = matches.filter(
      (match) =>
        match.score.total >= MINIMUM_TRACK_SCORE &&
        match.score.title >= MINIMUM_TITLE_SCORE &&
        (!artist || match.score.artist >= MINIMUM_ARTIST_SCORE),
    );

    this.logger.log(
      `YouTube search for "${title}"${artist ? ` by "${artist}"` : ''}: kept ${kept.length} of ${matches.length} hit(s)`,
    );

    if (kept.length === 0) {
      return this.deadEnd(
        `Nothing on YouTube is a recording of "${title}"${artist ? ` by ${artist}` : ''}` +
          (matches.length > 0 ? `, and none of the ${matches.length} uploads that came back are it` : '') +
          '.',
      );
    }

    const rows = kept
      .slice(0, MAX_LOOSE_TRACKS_REPORTED)
      .map((match) => this.renderTrackRow(match))
      .join('\n');

    return (
      '# TRACKS (YouTube, best match first — these are uploads, not a licensed catalog)\n' +
      'youtubeVideoId|title|artist|channel|duration|match\n' +
      `${rows}\n\n` +
      'Play the top one unless its title says it is a live take, a remix or a cover the user did not ask for.'
    );
  }

  private renderTrackRow(match: YoutubeTrackMatch): string {
    const duration = `${Math.floor(match.duration / 60)}:${(match.duration % 60).toString().padStart(2, '0')}`;

    return `${match.id}|${match.title}|${match.artist}|${match.channelTitle ?? ''}|${duration}|${match.score.total.toFixed(2)}`;
  }

  /* ------------------------------------------------------------------ */
  /* Artist route — what carries their name                             */
  /* ------------------------------------------------------------------ */

  /** No song and no record named: answer with the releases carrying their name. */
  private async searchArtistReleases(artist: string, album: string): Promise<string> {
    const playlists = await this.youtubeService.searchPlaylists(artist);
    const scored = this.scorePlaylists(playlists, artist, album || artist).filter(
      (entry) => entry.artist >= MINIMUM_ARTIST_SCORE,
    );

    if (scored.length === 0) {
      return this.deadEnd(`YouTube has nothing filed under "${artist}".`);
    }

    const rows = scored
      .slice(0, MAX_ALBUMS_REPORTED)
      .map(
        (entry) =>
          `${entry.playlist.id}|${stripReleasePrefix(entry.playlist.title)}|${entry.playlist.channelTitle ?? ''}`,
      )
      .join('\n');

    return (
      `# PLAYLISTS (YouTube — playlists carrying "${artist}", not a verified discography)\n` +
      `youtubePlaylistId|title|channel\n${rows}\n\n` +
      'Ask the user which one they meant before queueing a whole playlist you are not sure about.'
    );
  }

  /**
   * The wording that ends the search.
   *
   * YouTube is the last place anything is looked for, so an empty answer here ends the question
   * rather than prompting another attempt — and it has to say so, or the loop keeps going.
   */
  private deadEnd(what: string): string {
    return (
      `${what} Qobuz did not have it either, so there is nowhere else to look: this is the end of the search. ` +
      'Tell the user the music could not be found on Qobuz or on YouTube and stop. ' +
      'Do not search again with another spelling, do not try another tool, and do not play something else instead.'
    );
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
