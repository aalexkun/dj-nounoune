import { Logger } from '@nestjs/common';
import { SpotifyAlbumMatch, SpotifyArtistMatch, SpotifyTrackMatch } from '../../services/spotify/spotify.interfaces';

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

/** Renders one candidate as a single line: score, Spotify id, then the metadata. */
export function formatTrackMatch(match: SpotifyTrackMatch, criteria: PrintedCriteria): string {
  const breakdown = [`title ${match.score.title.toFixed(2)}`];
  if (criteria.artist) {
    breakdown.push(`artist ${match.score.artist.toFixed(2)}`);
  }
  if (criteria.album) {
    breakdown.push(`album ${match.score.album.toFixed(2)}`);
  }

  const flags: string[] = [];
  if (match.explicit) flags.push('explicit');
  if (!match.playable) flags.push('not playable here');

  return [
    `  [${match.score.total.toFixed(2)}]`,
    `id=${match.id}`,
    `"${match.title}"`,
    `— ${match.artist || 'unknown artist'}`,
    `— ${match.album || 'unknown album'}`,
    `(${formatDuration(match.duration)}${flags.length ? `, ${flags.join(', ')}` : ''})`,
    `[${breakdown.join(' / ')}]`,
  ].join(' ');
}

/** Prints the best match, then the remaining candidates. Assumes a non-empty list. */
export function printTrackMatches(logger: Logger, matches: SpotifyTrackMatch[], criteria: PrintedCriteria): void {
  const [best, ...others] = matches;

  logger.log(`Best match — Spotify track id ${best.id}`);
  console.log(formatTrackMatch(best, criteria));

  if (others.length > 0) {
    logger.log(`${others.length} other candidate(s):`);
    for (const match of others) {
      console.log(formatTrackMatch(match, criteria));
    }
  }
}

/** One artist per line, best match first. */
export function printArtists(logger: Logger, artists: SpotifyArtistMatch[]): void {
  logger.log(`${artists.length} artist(s):`);

  for (const artist of artists) {
    const genres = artist.genres.length ? artist.genres.slice(0, 3).join(', ') : 'no genre listed';
    console.log(`  id=${artist.id} "${artist.name}" (${genres})`);
  }
}

/** A discography, one album per line, ready to be handed to `spotify_start_playback` or the CLI. */
export function printAlbums(logger: Logger, albums: SpotifyAlbumMatch[]): void {
  logger.log(`${albums.length} release(s):`);

  for (const album of albums) {
    const year = album.releaseDate?.slice(0, 4) ?? '????';
    const count = album.trackCount !== undefined ? `${album.trackCount} track(s)` : 'unknown length';
    console.log(`  id=${album.id} "${album.title}" (${album.type}, ${year}, ${count})`);
  }
}
