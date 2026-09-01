import { Logger } from '@nestjs/common';
import { YoutubePlaylistMatch, YoutubePlaylistTrack, YoutubeTrackMatch } from '../../services/youtube/youtube.interfaces';

/**
 * Which criteria the search was given. Only these are broken down in the score column — the ones
 * the caller left out score 0 by construction and would read as a mismatch.
 */
export interface PrintedCriteria {
  artist?: string;
  album?: string;
}

function formatDuration(seconds: number): string {
  if (!seconds) {
    return '--:--';
  }

  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toString().padStart(2, '0');

  return `${minutes}:${rest}`;
}

/**
 * Renders one candidate as a single line: score, video id, then the metadata.
 *
 * The raw upload title is printed alongside the interpreted one whenever they differ. That is the
 * whole point of the listing — `parseVideoTitle` had to guess, and a human scanning the output is
 * the fastest way to catch a guess that went wrong.
 */
export function formatTrackMatch(match: YoutubeTrackMatch, criteria: PrintedCriteria): string {
  const breakdown = [`title ${match.score.title.toFixed(2)}`];
  if (criteria.artist) {
    breakdown.push(`artist ${match.score.artist.toFixed(2)}`);
  }
  if (criteria.album) {
    breakdown.push(`album ${match.score.album.toFixed(2)}`);
  }

  const flags: string[] = [];
  if (match.isTopicChannel) flags.push('topic');
  if (!match.isMusicCategory) flags.push('not music category');

  const interpreted = `"${match.title}" — ${match.artist || 'unknown artist'}`;
  const raw = match.videoTitle !== match.title ? ` (raw: "${match.videoTitle}")` : '';

  return [
    `  [${match.score.total.toFixed(2)}]`,
    `id=${match.id}`,
    interpreted + raw,
    `(${formatDuration(match.duration)}${flags.length ? `, ${flags.join(', ')}` : ''})`,
    `[${breakdown.join(' / ')}]`,
  ].join(' ');
}

/** Prints the best match, then the remaining candidates. Assumes a non-empty list. */
export function printTrackMatches(logger: Logger, matches: YoutubeTrackMatch[], criteria: PrintedCriteria): void {
  const [best, ...others] = matches;

  logger.log(`Best match — YouTube video id ${best.id}`);
  console.log(formatTrackMatch(best, criteria));

  if (others.length > 0) {
    logger.log(`${others.length} other candidate(s):`);
    for (const match of others) {
      console.log(formatTrackMatch(match, criteria));
    }
  }
}

/** One playlist per line, ready to be handed to `youtube import-playlist`. */
export function printPlaylists(logger: Logger, playlists: YoutubePlaylistMatch[]): void {
  logger.log(`${playlists.length} playlist(s):`);

  for (const playlist of playlists) {
    const count = playlist.itemCount !== undefined ? `${playlist.itemCount} track(s)` : 'unknown length';
    console.log(`  id=${playlist.id} "${playlist.title}" — ${playlist.channelTitle ?? 'unknown channel'} (${count})`);
  }
}

/** The tracks of a playlist in order, as the import would read them. */
export function printPlaylistTracks(logger: Logger, tracks: YoutubePlaylistTrack[]): void {
  logger.log(`${tracks.length} track(s):`);

  for (const track of tracks) {
    const raw = track.videoTitle !== track.title ? ` (raw: "${track.videoTitle}")` : '';
    console.log(
      `  ${String(track.trackNumber).padStart(2, ' ')}. id=${track.videoId} "${track.title}" — ${track.artist || 'unknown artist'}${raw}`,
    );
  }
}
