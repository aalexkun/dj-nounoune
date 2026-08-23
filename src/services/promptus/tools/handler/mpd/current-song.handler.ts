import { FunctionCallResult, ToolHandler } from '../../tool.type';

import { Logger } from '@nestjs/common';
import { MpdToolsDefinition } from '../../definition/mpd-tools.definition';
import { MpdClientService } from '../../../../mpd-client/mpd-client.service';
import { CurrentSongMpdRequest } from '../../../../mpd-client/requests/CurrentSongMpdRequest';
import { CurrentSongInfo } from '../../../../mpd-client/responses/CurrentSongMpdResponse';
import { MusicDbService } from '../../../../music-db/music-db.service';
import { NowPlaying, NowPlayingSource } from '../../../../playlog/now-playing.event';
import { parseSourceUri } from '../../../../../config/source-uri.util';
import { getErrorMessage } from '../../../../../utils/error.utils';

/**
 * What the model is told about the running track.
 *
 * Built from the `PlaylogService` snapshot rather than from MPD: that snapshot is the enriched view
 * the /vibing-on page renders — genre, emotion, pace, label, the technical info of the source
 * actually streaming and the disc jockey's own commentary — where MPD only carries the tags the
 * file happens to hold. The Qobuz ids ride along so the favourite tool can act on "this song"
 * without a second lookup.
 */
type CurrentSongPayload = Omit<NowPlaying, 'recent'> & {
  /** Id of the source `sourceName` names — a Qobuz id, a Spotify id, or the local path. */
  sourceId?: string;
  qobuzTrackId?: string;
  qobuzAlbumId?: string;
  recentlyPlayed?: string[];
};

export class CurrentSongHandler implements ToolHandler {
  readonly name = MpdToolsDefinition.currentMpdCommand.name;
  private readonly logger = new Logger('CurrentSongHandler');

  /**
   * @param mpdClientService
   * @param musicDbService
   * @param nowPlayingSource resolved lazily — `PlaylogService` registers itself on module init,
   *   which is after this handler is constructed.
   */
  constructor(
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
    private nowPlayingSource: () => NowPlayingSource | undefined,
  ) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      const snapshot = await this.snapshot();

      if (snapshot) {
        return {
          message: JSON.stringify(await this.toPayload(snapshot)),
          name: this.name,
          type: 'string',
        };
      }

      return {
        message: JSON.stringify(await this.fromMpd()),
        name: this.name,
        type: 'string',
      };
    } catch (e) {
      const msg = 'Function call failed with error: ' + getErrorMessage(e);
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
        type: 'string',
      };
    }
  }

  private async snapshot(): Promise<NowPlaying | null> {
    const source = this.nowPlayingSource();

    if (!source) {
      this.logger.debug('No now-playing source registered, reading the current song off MPD');
      return null;
    }

    return source.getNowPlayingSnapshot();
  }

  /** Flattens the strip of recent tracks and adds the Qobuz ids the favourite tool needs. */
  private async toPayload(snapshot: NowPlaying): Promise<CurrentSongPayload> {
    const { recent, ...rest } = snapshot;
    const payload: CurrentSongPayload = { ...rest };

    if (recent?.length) {
      payload.recentlyPlayed = recent.map((played) => `${played.artist} - ${played.title}`);
    }

    const [song] = await this.musicDbService.getPopulatedSongsByIds([snapshot.songId]);

    if (song) {
      payload.sourceId = song.source?.find((source) => source.name === snapshot.sourceName)?.sourceId ?? undefined;
      payload.qobuzTrackId = song.source?.find((source) => source.name === 'qobuz')?.sourceId ?? undefined;
      payload.qobuzAlbumId = song.album?.source?.find((source) => source.name === 'qobuz')?.sourceId ?? undefined;
    }

    return payload;
  }

  /**
   * Fallback for when no snapshot exists: under `IS_CLI` the playlog poller never runs, nothing is
   * published until the first song change of a fresh server, and MPD may be on a track the library
   * does not hold at all.
   *
   * The queue is mixed across services, so the uri is resolved through `parseSourceUri` rather than
   * pattern-matched for one provider. When the library has no matching song — a Spotify or YouTube
   * stream queued by another client, a file outside the import root — the MPD tags are reported as
   * they are, with the service named and `inLibrary: false`, so the model describes a stream it
   * cannot act on instead of mistaking a proxy url for a title.
   */
  private async fromMpd(): Promise<Record<string, unknown>> {
    const result = await this.mpdClientService.send(new CurrentSongMpdRequest());
    const uri = result?.song?.file;

    if (!uri) {
      return { status: 'No song is currently playing.' };
    }

    const { name, sourceId } = parseSourceUri(uri);
    const song = await this.musicDbService.findPopulatedSongBySource(name, sourceId);

    if (!song) {
      return {
        ...this.mpdTags(result.song),
        sourceName: name,
        sourceId,
        inLibrary: false,
      };
    }

    return {
      songId: song._id.toString(),
      title: song.title,
      artist: song.artist?.artist,
      album: song.album?.title,
      year: song.year || song.album?.release_year,
      genre: song.genre,
      category: song.category,
      emotion: song.emotion,
      pace: song.pace,
      country: song.country,
      language: song.language,
      sourceName: name,
      sourceId,
      qobuzTrackId: song.source?.find((source) => source.name === 'qobuz')?.sourceId ?? undefined,
      qobuzAlbumId: song.album?.source?.find((source) => source.name === 'qobuz')?.sourceId ?? undefined,
      inLibrary: true,
    };
  }

  /** The three tags worth relaying. The rest of `CurrentSongInfo` is MPD bookkeeping. */
  private mpdTags(song: CurrentSongInfo | null): Record<string, unknown> {
    return {
      title: song?.title,
      artist: song?.artist,
      album: song?.album,
    };
  }
}
