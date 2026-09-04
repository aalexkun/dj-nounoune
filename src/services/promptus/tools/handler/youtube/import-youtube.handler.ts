import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { YoutubeToolsDefinition } from '../../definition/youtube-tools.definition';
import { YoutubeService } from '../../../../youtube/youtube.service';
import { YoutubeImportResult, YoutubePlaylistMatch, YoutubeVideo } from '../../../../youtube/youtube.interfaces';
import { parseVideoTitle, stripReleasePrefix } from '../../../../youtube/youtube-track-match.util';
import { getErrorMessage } from '../../../../../utils/error.utils';

interface ImportYoutubeArgs {
  playlistIds?: string[];
  videoIds?: string[];
  artist_name?: string;
  album_title?: string;
}

/** One playlist about to be imported, with the reason it is on the list. */
type ImportTarget = {
  playlistId: string;
  /** What the user pointed at: a playlist id given outright, or a video resolved to its record. */
  via: string;
};

/** YouTube Music's auto-generated release playlists: one per record, right order, no extras. */
const RELEASE_PLAYLIST_PREFIX = 'OLAK5uy_';

/**
 * How many playlists are opened per search to see whether one holds the video.
 *
 * Each costs one quota unit against the hundred the search itself cost, so the cap is about
 * time rather than quota: a release playlist that contains the video is almost always in the
 * first few hits, and past that the hits are fan-made playlists that happen to share a word.
 */
const MAX_PLAYLISTS_CHECKED_PER_SEARCH = 4;

/**
 * Imports YouTube music into the library — the chat's door onto `youtube import-playlist`.
 *
 * Same principle as the CLI: **a playlist is the album**, and it is the only YouTube object with
 * enough structure to import. A lone video has a title and a channel, nothing that fills an
 * `Album` document, so a video id is never imported on its own. It is resolved to the release
 * playlist containing it and *that* is imported whole — which is also what the user means by
 * "add this" said over a playing track, for the same reason `FavoriteQobuzHandler` saves the
 * album by default: people collect records.
 *
 * Resolving a video to its record is the difficult part, because the Data API has no
 * video-to-album link. The playlist search is asked for the record by name when a name is known
 * (the `album_title` hint, usually read off the MPD tags by `current_song`), and by the track
 * otherwise, and every candidate is opened to check the video is actually in it. That check is
 * what keeps a search for a common title from importing somebody else's record.
 */
export class ImportYoutubeHandler implements ToolHandler {
  readonly name = YoutubeToolsDefinition.importCommand.name;
  private readonly logger = new Logger('ImportYoutubeHandler');

  constructor(private readonly youtubeService: YoutubeService) {}

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }

  private isImportArgs(args: unknown): args is ImportYoutubeArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }

    const record = args as Record<string, unknown>;
    const optionalString = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string';
    const optionalList = (value: unknown): boolean => value === undefined || value === null || this.isStringArray(value);

    return (
      optionalList(record.playlistIds) && optionalList(record.videoIds) && optionalString(record.artist_name) && optionalString(record.album_title)
    );
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isImportArgs(args)) {
      return this.reply(
        `Invalid arguments provided to ${this.name}. Expected playlistIds and/or videoIds as arrays of strings, plus optional artist_name and album_title strings.`,
      );
    }

    const playlistIds = (args.playlistIds ?? []).map((id) => id.trim()).filter(Boolean);
    const videoIds = (args.videoIds ?? []).map((id) => id.trim()).filter(Boolean);
    const artistHint = args.artist_name?.trim() ?? '';
    const albumHint = args.album_title?.trim() ?? '';

    if (playlistIds.length === 0 && videoIds.length === 0) {
      return this.reply(
        'Nothing to import: give at least one YouTube playlist id or video id. Only music playing from YouTube, or found by youtube_search_music, can be imported this way — a Qobuz id or a local file cannot.',
      );
    }

    try {
      const failures: string[] = [];
      const targets = new Map<string, ImportTarget>();

      for (const playlistId of playlistIds) {
        targets.set(playlistId, { playlistId, via: `playlist ${playlistId}` });
      }

      for (const videoId of videoIds) {
        const playlistId = await this.playlistOfVideo(videoId, artistHint, albumHint, failures);

        // A video whose record was already given as a playlist id must not import it twice.
        if (playlistId && !targets.has(playlistId)) {
          targets.set(playlistId, { playlistId, via: `video ${videoId}` });
        }
      }

      if (targets.size === 0) {
        return this.reply(
          `Nothing could be imported: no playlist was found to import.${this.renderFailures(failures)}\n\n` +
            'Tell the user the recording could not be tied to a record on YouTube, so there was nothing to import as an album.',
        );
      }

      const imported: string[] = [];

      for (const target of targets.values()) {
        try {
          const result = await this.youtubeService.importPlaylist(target.playlistId);
          imported.push(this.renderResult(result));
        } catch (error) {
          this.logger.warn(`Could not import YouTube playlist ${target.playlistId}: ${getErrorMessage(error)}`);
          failures.push(`${target.via} (${getErrorMessage(error)})`);
        }
      }

      if (imported.length === 0) {
        return this.reply(`Nothing could be imported.${this.renderFailures(failures)}`);
      }

      this.logger.log(`Imported ${imported.length} YouTube playlist(s) into the library.`);

      return this.reply(
        `Imported into the library, as albums:\n\n${imported.join('\n\n')}${this.renderFailures(failures)}\n\n` +
          'Tell the user which album and artist were imported. The songs are in the library now; their genre, mood and pace ' +
          'are filled in later by the enrichment pass, so do not describe them as enriched yet.',
      );
    } catch (error) {
      // Quota exhaustion arrives here, and the model must not read it as "this music cannot be imported".
      const message = `The YouTube import failed: ${getErrorMessage(error)}`;
      this.logger.error(message);
      return this.reply(`${message} Tell the user the import could not be run right now.`);
    }
  }

  /**
   * The release playlist holding a video, or `null` with the reason pushed to `failures`.
   *
   * Two searches at most, each costing a hundred quota units: by album name when one is known,
   * then by artist and track. Within a search the auto-generated release playlists are opened
   * first — one per record, so a hit there is the record itself — before any hand-made playlist
   * of the same name.
   */
  private async playlistOfVideo(videoId: string, artistHint: string, albumHint: string, failures: string[]): Promise<string | null> {
    let video: YoutubeVideo | null;

    try {
      video = await this.youtubeService.getVideo(videoId);
    } catch (error) {
      this.logger.warn(`Could not read YouTube video ${videoId}: ${getErrorMessage(error)}`);
      failures.push(`video ${videoId} (${getErrorMessage(error)})`);
      return null;
    }

    if (!video) {
      failures.push(`video ${videoId} (no such video, or it is private)`);
      return null;
    }

    const parsed = parseVideoTitle(video.snippet?.title ?? '', video.snippet?.channelTitle);
    const artist = artistHint || parsed.artist;
    const title = parsed.title;
    const label = [artist, title].filter(Boolean).join(' - ') || videoId;

    const queries = [albumHint ? [artist, albumHint].filter(Boolean).join(' ') : '', [artist, title].filter(Boolean).join(' ')]
      .map((query) => query.trim())
      .filter((query, index, all) => query && all.indexOf(query) === index);

    for (const query of queries) {
      let playlists: YoutubePlaylistMatch[];

      try {
        playlists = await this.youtubeService.searchPlaylists(query);
      } catch (error) {
        this.logger.warn(`YouTube playlist search failed for "${query}": ${getErrorMessage(error)}`);
        continue;
      }

      const candidates = this.releaseFirst(playlists).slice(0, MAX_PLAYLISTS_CHECKED_PER_SEARCH);

      for (const candidate of candidates) {
        if (await this.playlistContains(candidate.id, videoId)) {
          this.logger.log(`YouTube video ${videoId} ("${label}") resolved to playlist "${candidate.title}" (${candidate.id})`);
          return candidate.id;
        }
      }
    }

    failures.push(`video ${videoId} ("${label}") is in no release playlist that could be found, so there is no album to import it as`);
    return null;
  }

  /** Release playlists ahead of the rest, otherwise in the order the search ranked them. */
  private releaseFirst(playlists: YoutubePlaylistMatch[]): YoutubePlaylistMatch[] {
    const releases = playlists.filter((playlist) => playlist.id.startsWith(RELEASE_PLAYLIST_PREFIX));
    const others = playlists.filter((playlist) => !playlist.id.startsWith(RELEASE_PLAYLIST_PREFIX));

    return [...releases, ...others];
  }

  /** Whether the video is actually in the playlist. Best-effort: an unreadable playlist is a no. */
  private async playlistContains(playlistId: string, videoId: string): Promise<boolean> {
    try {
      const items = await this.youtubeService.getPlaylistItems(playlistId);
      return items.some((item) => item.videoId === videoId);
    } catch (error) {
      this.logger.debug(`Could not read YouTube playlist ${playlistId}: ${getErrorMessage(error)}`);
      return false;
    }
  }

  /** The CLI's summary, in one paragraph the model can relay. */
  private renderResult(result: YoutubeImportResult): string {
    const lines = [
      `- "${stripReleasePrefix(result.playlistTitle)}" by ${result.artistName || 'an unknown artist'} (playlist ${result.playlistId})`,
      `  ${result.tracksSeen} track(s): ${result.songsCreated} added, ${result.sourcesAttached} attached to songs the library already had, ${result.alreadyPresent} already present`,
    ];

    if (result.skipped.length > 0) {
      lines.push(`  ${result.skipped.length} track(s) failed: ${result.skipped.join('; ')}`);
    }

    return lines.join('\n');
  }

  private renderFailures(failures: string[]): string {
    if (failures.length === 0) return '';

    return `\n\nSkipped:\n${failures.map((failure) => `- ${failure}`).join('\n')}`;
  }

  private reply(message: string): FunctionCallResult {
    return { message, name: this.name, type: 'string' };
  }
}
