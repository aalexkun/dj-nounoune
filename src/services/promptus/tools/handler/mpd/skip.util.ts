import { Logger } from '@nestjs/common';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { getErrorMessage } from '../../../../../utils/error.utils';

/**
 * What landed after a skip, so the model can answer "next!" with the title it moved to rather than
 * having to spend another turn on `current_song`. Best effort by design: the skip itself already
 * succeeded by the time this runs, so a failed lookup must not turn into a failed tool call.
 */
export async function describeTrackAfterSkip(mpdClient: MpdClientService, logger: Logger): Promise<string> {
  try {
    const current = await mpdClient.currentsong();
    const song = current?.song;

    if (!song) {
      return 'The queue is now empty.';
    }

    const title = song.title ?? song.file;
    const label = song.artist ? `"${title}" by ${song.artist}` : `"${title}"`;

    return `Now playing ${label}.`;
  } catch (e) {
    logger.warn(`Could not read the track reached by the skip: ${getErrorMessage(e)}`);
    return 'Use disc_jockey_what_is_playing to find out what is on now.';
  }
}
