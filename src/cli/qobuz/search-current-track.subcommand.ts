import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { QobuzService } from '../../services/qobuz/qobuz.service';
import { MusicDbService } from '../../services/music-db/music-db.service';
import { SongSource } from '../../schemas/source.schema';
import { getErrorMessage } from '../../utils/error.utils';
import { printTrackMatches } from './track-match.printer';

interface SearchCurrentTrackOptions {
  json?: boolean;
}

@SubCommand({
  name: 'search-current-track',
  description: 'Search the Qobuz catalog for the track the database says is currently playing',
})
@Injectable()
export class QobuzSearchCurrentTrackSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzSearchCurrentTrackSubCommand.name);

  constructor(
    private readonly qobuzService: QobuzService,
    private readonly musicDbService: MusicDbService,
  ) {
    super();
  }

  async run(inputs: string[], options: SearchCurrentTrackOptions): Promise<void> {
    try {
      const lastPlayed = await this.musicDbService.getLastPlayedSong();

      if (!lastPlayed) {
        this.logger.error('The playlog is empty — nothing to look up. Is the server running?');
        return;
      }

      const { playedAt, song } = lastPlayed;
      const title = song.title;
      const artist = song.artist?.artist;
      const album = song.album?.title;

      if (!title) {
        this.logger.error(`The current playlog entry (song ${song._id}) has no title to search for.`);
        return;
      }

      this.reportCurrentTrack(title, artist, album, playedAt, song.source);

      const matches = await this.qobuzService.searchTracks({ title, artist, album });

      if (options.json) {
        console.log(JSON.stringify(matches, null, 2));
        return;
      }

      if (matches.length === 0) {
        this.logger.warn(`No Qobuz track found for "${title}".`);
        return;
      }

      printTrackMatches(this.logger, matches, { artist, album });
    } catch (error) {
      this.logger.error(`Qobuz current-track search failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * The playlog only advances while the server is polling MPD, and this command
   * runs with that poller off — so say how old the entry is rather than let a
   * stale answer pass for the current track.
   */
  private reportCurrentTrack(
    title: string,
    artist: string | undefined,
    album: string | undefined,
    playedAt: Date,
    sources: SongSource[] | undefined,
  ): void {
    const ageMinutes = Math.round((Date.now() - playedAt.getTime()) / 60000);

    this.logger.log(`Currently playing per the playlog (started ${ageMinutes} min ago):`);
    console.log(`  title : ${title}`);
    console.log(`  artist: ${artist ?? '(unknown)'}`);
    console.log(`  album : ${album ?? '(unknown)'}`);

    // Worth saying up front: if the song already carries a qobuz source, the id
    // the search is about to go looking for is already on the document.
    const qobuzSource = (sources ?? []).find((source) => source.name === 'qobuz');

    if (qobuzSource?.sourceId) {
      this.logger.warn(`This song already has a qobuz source: track id ${qobuzSource.sourceId}`);
    }
  }

  @Option({
    flags: '-j, --json',
    description: 'Print the raw ranked matches as JSON',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }
}
