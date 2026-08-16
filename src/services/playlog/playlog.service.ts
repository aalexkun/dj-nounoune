import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Playlog, PlaylogDocument } from '../../schemas/playlog.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { SourceType } from '../../schemas/source.schema';
import { TechnicalInfo } from '../../schemas/technical-info.schema';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { CurrentSongMpdResponse } from '../mpd-client/responses/CurrentSongMpdResponse';
import { MusicDbService, PopulatedSong } from '../music-db/music-db.service';
import { ToolsService } from '../promptus/tools.service';
import { AppService } from '../../app.service';
import { DiscJockeyAgent } from '../promptus/agent/disc-jockey/disc-jockey.agent';
import { getErrorMessage } from '../../utils/error.utils';
import { isReachableImageUrl } from '../../utils/image-url.util';
import {
  NowPlaying,
  NowPlayingCommentaryEvent,
  NowPlayingCommentaryEventName,
  NowPlayingCoverEvent,
  NowPlayingCoverEventName,
  NowPlayingEvent,
  NowPlayingEventName,
  RecentlyPlayed,
} from './now-playing.event';

type MpdSongLookup = {
  song?: SongDocument | null;
  mpdResponse?: CurrentSongMpdResponse;
  /** Which source MPD is streaming from, so the page shows the technical info actually in use. */
  sourceName?: SourceType;
};

@Injectable()
export class PlaylogService {
  private readonly logger = new Logger(PlaylogService.name);

  /** Last published snapshot, served to page loads and to websocket clients that connect mid-track. */
  private currentNowPlaying: NowPlaying | null = null;

  /** Playlog behind that snapshot, kept so enrichment can still be run later for the same play. */
  private currentPlaylog: PlaylogDocument | null = null;

  /** Viewers on the /vibing namespace, reported by `VibingGateway`. No viewers, no model calls. */
  private viewerCount = 0;

  /** Song currently being enriched, so a second viewer joining does not start the work again. */
  private enrichingSongId: string | null = null;

  constructor(
    @InjectModel(Playlog.name) private playlogModel: Model<PlaylogDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
    private toolsService: ToolsService,
    private eventEmitter: EventEmitter2,
    private appService: AppService,
  ) {}

  get nowPlaying(): NowPlaying | null {
    return this.currentNowPlaying;
  }

  /** Reported by `VibingGateway` on every connect and disconnect. */
  setViewerCount(count: number): void {
    this.viewerCount = count;
  }

  /**
   * Called when someone opens the page. The track playing at that moment was published without its
   * enrichments — nobody was watching to read them — so fetch whichever is still missing.
   */
  async enrichCurrentIfNeeded(): Promise<void> {
    if (this.viewerCount === 0) return;
    if (!this.currentNowPlaying || !this.currentPlaylog) return;
    if (this.enrichingSongId === this.currentNowPlaying.songId) return;
    if (!this.needsEnrichment(this.currentNowPlaying)) return;

    await this.enrichNowPlaying(this.currentPlaylog, this.currentNowPlaying);
  }

  /** A missing cover is only worth another pass while the search that could fill it is switched on. */
  private needsEnrichment(snapshot: NowPlaying): boolean {
    if (!snapshot.description) return true;
    return !snapshot.coverUrl && this.appService.isAlbumCoverSearchEnabled();
  }

  @Interval(10000)
  async checkCurrentSong() {
    if (process.env.IS_CLI === 'true') return;

    try {

      const { song, mpdResponse, sourceName } = await this.getMpdSong();

      if (!song) {
        this.logger.debug(`No songId found for file: ${mpdResponse?.song?.file}`);
        return;
      }

      const previousPlaylog = await this.fetchPreviousSong();
      const previousSongId = previousPlaylog?.songId?.toString();


      this.logger.debug(`Current song: ${mpdResponse?.song?.file}`);
      this.logger.debug(`Current songId: ${previousSongId}`);

      if (song._id.toString() != previousSongId) {

        const newPlaylog = new this.playlogModel({
          playedAt: new Date(),
          raw: mpdResponse?.rawResponse,
          title: song.title,
          artist: song.artist,
          album: song.album,
          songId: song._id.toString(),
        });

        const savedPlaylog = await newPlaylog.save();
        this.logger.log(`Created new playlog entry: ${savedPlaylog._id}`);

        await this.publishNowPlaying(savedPlaylog, sourceName);
      } else if (!this.currentNowPlaying && previousPlaylog) {
        // Cold start: the running track was already logged before this process began, so publish
        // from that entry rather than leaving the page blank until the next song change.
        await this.publishNowPlaying(previousPlaylog, sourceName);
      }

    } catch (error: any) {
      this.logger.error(`Error checking current song: ${error.message}`);
    }

  }


  private async getMpdSong(): Promise<MpdSongLookup> {

    const mpdResponse = await this.mpdClientService.currentsong();
    if (!mpdResponse || !mpdResponse.song || !mpdResponse.song.file) {
      return {};
    }

    const file = mpdResponse.song.file;

    let song: SongDocument | null = null;
    let sourceName: SourceType | undefined;

    if (file.includes('/qobuz/track/')) {
      const parts = file.split('/trackId/');
      const qobuzId = parts.length > 1 ? parts[1] : null;

      if (qobuzId) {
        sourceName = 'qobuz';
        song = await this.songModel.findOne({
          source: { $elemMatch: { name: 'qobuz', sourceId: qobuzId } },
        });
      }
    } else {
      sourceName = 'file';
      song = await this.songModel.findOne({
        source: { $elemMatch: { name: 'file', sourceId: file } },
      });
    }

    return { song, mpdResponse, sourceName };
  }

  private async fetchPreviousSong(): Promise<PlaylogDocument | null> {
    try {
      return await this.playlogModel.findOne().sort({ playedAt: -1 }).exec();
    } catch (error: any) {
      this.logger.error(`Error initializing last played file from DB: ${error.message}`);
      return null;
    }
  }

  /**
   * Build the public now-playing snapshot from Mongo and push it immediately, then let the LLM
   * enrichment catch up in the background and push a second time.
   */
  private async publishNowPlaying(playlog: PlaylogDocument, sourceName?: SourceType): Promise<void> {
    try {
      const songId = playlog.songId.toString();
      const [populated] = await this.musicDbService.getPopulatedSongsByIds([songId]);

      if (!populated) {
        this.logger.warn(`Could not populate song ${songId} for the now-playing snapshot`);
        return;
      }

      const technical = this.technicalInfoOf(populated, sourceName);
      const image = populated.album?.image;

      const snapshot: NowPlaying = {
        songId,
        title: populated.title,
        artist: populated.artist?.artist,
        album: populated.album?.title,
        year: populated.year || populated.album?.release_year,
        genre: populated.genre,
        category: populated.category,
        emotion: populated.emotion,
        pace: populated.pace,
        trackNumber: populated.track_number,
        discNumber: populated.disc_number,
        label: populated.album?.record_label,
        country: populated.country,
        language: populated.language,
        sourceName,
        encoding: technical?.encoding,
        bitrate: technical?.bitrate,
        sampleRate: technical?.sample_rate,
        bitDepth: technical?.bit_depth,
        isHighRes: technical?.is_high_res,
        duration: technical?.duration,
        bpm: technical?.bpm,
        coverUrl: image?.large || image?.thumbnail || image?.small,
        artistIntro: populated.artist?.short_intro,
        playedAt: playlog.playedAt.toISOString(),
        recent: await this.fetchRecentlyPlayed(playlog),
      };

      this.currentPlaylog = playlog;
      this.emitNowPlaying(snapshot);

      if (this.viewerCount === 0) {
        this.logger.debug('No vibing viewers, skipping the commentary and cover lookup');
        return;
      }

      // Deliberately not awaited: the interval must not wait on the LLM.
      void this.enrichNowPlaying(playlog, snapshot);
    } catch (error: unknown) {
      this.logger.error(`Error publishing now-playing: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Start both enrichments and let each announce itself the moment it lands. They share nothing but
   * the reuse lookup, so the commentary is not held behind an artwork search that may take just as
   * long and fail, and neither of them delays the snapshot that already went out.
   */
  private async enrichNowPlaying(playlog: PlaylogDocument, snapshot: NowPlaying): Promise<void> {
    this.enrichingSongId = snapshot.songId;

    try {
      const discJockey = this.toolsService.getDiscJockeyAgent();

      if (!discJockey) {
        this.logger.warn('Disc jockey agent is not available yet, skipping now-playing enrichment');
        return;
      }

      // One cheap lookup up front: an earlier play of the same song spares both model calls.
      const previous = await this.playlogModel
        .findOne({ _id: { $ne: playlog._id }, songId: playlog.songId, description: { $exists: true, $ne: null } })
        .sort({ playedAt: -1 })
        .exec();

      await Promise.allSettled([
        this.resolveCommentary(discJockey, playlog, snapshot, previous?.description),
        this.resolveCover(discJockey, playlog, snapshot, previous?.coverUrl),
      ]);
    } catch (error: unknown) {
      this.logger.error(`Error enriching now-playing: ${getErrorMessage(error)}`);
    } finally {
      this.enrichingSongId = null;
    }
  }

  private async resolveCommentary(
    discJockey: DiscJockeyAgent,
    playlog: PlaylogDocument,
    snapshot: NowPlaying,
    cached?: string,
  ): Promise<void> {
    if (snapshot.description) return;

    try {
      // Name the track rather than letting the agent ask MPD: by the time the model calls the tool the
      // track may have advanced, and the commentary would then describe a song the page is not showing.
      const description = cached ?? (await discJockey.whatIsPlaying(this.describeTrack(snapshot), undefined, { withoutCurrentSongTool: true })).text;

      if (!description || !this.isStillPlaying(snapshot, 'commentary')) return;

      await this.playlogModel.updateOne({ _id: playlog._id }, { $set: { description } }).exec();
      this.currentNowPlaying = { ...this.currentNowPlaying, description } as NowPlaying;

      this.eventEmitter.emit(NowPlayingCommentaryEventName, new NowPlayingCommentaryEvent({ songId: snapshot.songId, description }));
    } catch (error: unknown) {
      this.logger.error(`Error resolving the commentary: ${getErrorMessage(error)}`);
    }
  }

  private async resolveCover(
    discJockey: DiscJockeyAgent,
    playlog: PlaylogDocument,
    snapshot: NowPlaying,
    cached?: string,
  ): Promise<void> {
    // Already carried by the base snapshot, straight off the album document.
    if (snapshot.coverUrl) return;

    try {
      let coverUrl = cached;

      if (!coverUrl) {
        if (!this.appService.isAlbumCoverSearchEnabled()) {
          this.logger.debug('Album cover search is disabled, leaving the artwork empty');
          return;
        }

        coverUrl = (await this.searchAlbumCover(discJockey, snapshot)) ?? undefined;
      }

      if (!coverUrl || !this.isStillPlaying(snapshot, 'cover')) return;

      await this.playlogModel.updateOne({ _id: playlog._id }, { $set: { coverUrl } }).exec();
      this.currentNowPlaying = { ...this.currentNowPlaying, coverUrl } as NowPlaying;

      this.eventEmitter.emit(NowPlayingCoverEventName, new NowPlayingCoverEvent({ songId: snapshot.songId, coverUrl }));
    } catch (error: unknown) {
      this.logger.error(`Error resolving the album cover: ${getErrorMessage(error)}`);
    }
  }

  /** Pins the commentary to one track, so it cannot drift onto whatever started in the meantime. */
  private describeTrack(snapshot: NowPlaying): string {
    const facts = [`"${snapshot.title}" by ${snapshot.artist}`];

    if (snapshot.album) facts.push(`from the album "${snapshot.album}"`);
    if (snapshot.year) facts.push(`released ${snapshot.year}`);
    if (snapshot.genre) facts.push(`genre ${snapshot.genre}`);

    return `Tell me about this track: ${facts.join(', ')}.`;
  }

  private isStillPlaying(snapshot: NowPlaying, what: string): boolean {
    if (this.currentNowPlaying?.songId === snapshot.songId) return true;

    this.logger.debug(`Track changed while resolving the ${what} for ${snapshot.songId}, discarding it`);
    return false;
  }

  /**
   * Fallback for releases the importers left without artwork. The model can return a fabricated URL,
   * so the result is only kept once it is confirmed to be a real image.
   */
  private async searchAlbumCover(discJockey: DiscJockeyAgent, snapshot: NowPlaying): Promise<string | null> {
    try {
      // Isolated from the caller's Promise.all: artwork is optional, the commentary beside it is not.
      const candidate = await discJockey.findAlbumCover(snapshot.artist, snapshot.album);

      if (!candidate) return null;

      if (!(await isReachableImageUrl(candidate))) {
        this.logger.warn(`Discarding unreachable album cover for ${snapshot.artist} - ${snapshot.album}: ${candidate}`);
        return null;
      }

      return candidate;
    } catch (error: unknown) {
      this.logger.warn(`Album cover lookup failed for ${snapshot.artist} - ${snapshot.album}: ${getErrorMessage(error)}`);
      return null;
    }
  }

  private emitNowPlaying(snapshot: NowPlaying): void {
    this.currentNowPlaying = snapshot;
    this.eventEmitter.emit(NowPlayingEventName, new NowPlayingEvent(snapshot));
  }

  /** The tracks played before this one. `Playlog.artist` carries no ref, so the songs are reloaded. */
  private async fetchRecentlyPlayed(current: PlaylogDocument): Promise<RecentlyPlayed[]> {
    const playlogs = await this.playlogModel
      .find({ _id: { $ne: current._id } })
      .sort({ playedAt: -1 })
      .limit(4)
      .exec();

    if (playlogs.length === 0) return [];

    const songs = await this.musicDbService.getPopulatedSongsByIds(playlogs.map((playlog) => playlog.songId.toString()));
    const byId = new Map(songs.map((song) => [song._id.toString(), song]));

    return playlogs.map((playlog) => {
      const song = byId.get(playlog.songId.toString());
      const image = song?.album?.image;
      return {
        title: song?.title || playlog.title || 'unknown',
        artist: song?.artist?.artist || 'unknown',
        coverUrl: playlog.coverUrl || image?.thumbnail || image?.small || image?.large,
      };
    });
  }

  private technicalInfoOf(song: PopulatedSong, sourceName?: SourceType): TechnicalInfo | undefined {
    const sources = song.source ?? [];
    const playing = sourceName ? sources.find((source) => source.name === sourceName) : undefined;
    return (playing ?? sources.find((source) => source.technical_info))?.technical_info;
  }

  async handleFeedbackEvent(groupedCounts: Record<string, number>) {

    const { song } = await this.getMpdSong();

    if (!song) {
      return;
    }

    const validFeedbackTypes = ['awesome', 'wtf', 'great', 'duh'];
    const updateQuery: Record<string, number> = {};
    let hasUpdates = false;

    for (const [feedbackType, count] of Object.entries(groupedCounts)) {
      if (validFeedbackTypes.includes(feedbackType)) {
        updateQuery[`feedback.${feedbackType}`] = count;
        hasUpdates = true;
      } else {
        this.logger.warn(`Unknown feedback type received: ${feedbackType}`);
      }
    }

    if (!hasUpdates) {
      return;
    }

    try {
      await this.playlogModel.findOneAndUpdate({ songId: song.id }, { $inc: updateQuery }, { sort: { playedAt: -1 } });
        this.logger.log(`Incremented feedback counts for playlog ${song.id}`);
    } catch (error: any) {
      this.logger.error(`Error updating playlog feedback: ${error.message}`);
    }
  }
}
