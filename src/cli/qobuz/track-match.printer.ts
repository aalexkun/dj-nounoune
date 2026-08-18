import { Logger } from '@nestjs/common';
import { QobuzTrackMatch } from '../../services/qobuz/qobuz.interfaces';

/**
 * Which criteria the search was given. Only these are broken down in the score
 * column — the ones the caller left out score 0 by construction and would read
 * as a mismatch.
 */
export interface PrintedCriteria {
  artist?: string;
  album?: string;
}

/** Renders one candidate as a single line: score, Qobuz id, then the metadata. */
export function formatTrackMatch(match: QobuzTrackMatch, criteria: PrintedCriteria): string {
  const displayTitle = match.version ? `${match.title} (${match.version})` : match.title;
  const quality = match.hires ? 'hi-res' : 'cd';
  const minutes = Math.floor(match.duration / 60);
  const seconds = (match.duration % 60).toString().padStart(2, '0');

  const breakdown = [`title ${match.score.title.toFixed(2)}`];
  if (criteria.artist) {
    breakdown.push(`artist ${match.score.artist.toFixed(2)}`);
  }
  if (criteria.album) {
    breakdown.push(`album ${match.score.album.toFixed(2)}`);
  }

  return [
    `  [${match.score.total.toFixed(2)}]`,
    `id=${match.id}`,
    `"${displayTitle}"`,
    `— ${match.artist || 'unknown artist'}`,
    `— ${match.album || 'unknown album'}`,
    `(${minutes}:${seconds}, ${quality}${match.streamable ? '' : ', not streamable'})`,
    `[${breakdown.join(' / ')}]`,
  ].join(' ');
}

/** Prints the best match, then the remaining candidates. Assumes a non-empty list. */
export function printTrackMatches(logger: Logger, matches: QobuzTrackMatch[], criteria: PrintedCriteria): void {
  const [best, ...others] = matches;

  logger.log(`Best match — Qobuz track id ${best.id}`);
  console.log(formatTrackMatch(best, criteria));

  if (others.length > 0) {
    logger.log(`${others.length} other candidate(s):`);
    for (const match of others) {
      console.log(formatTrackMatch(match, criteria));
    }
  }
}
