import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Playlog, PlaylogDocument } from '../../schemas/playlog.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { MpdClientService } from '../mpd-client/mpd-client.service';

@Injectable()
export class PlaylogService {
  private readonly logger = new Logger(PlaylogService.name);


  constructor(
    @InjectModel(Playlog.name) private playlogModel: Model<PlaylogDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
    private mpdClientService: MpdClientService,
  ) {}

  @Interval(10000)
  async checkCurrentSong() {
    if (process.env.IS_CLI === 'true') return;

    try {

      const { song, mpdResponse } = await this.getMpdSong();

      if (!song) {
        this.logger.debug(`No songId found for file: ${mpdResponse?.song?.file}`);
        return;
      }

      const previousSongId = await this.fetchPreviousSong();


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
      }

    } catch (error: any) {
      this.logger.error(`Error checking current song: ${error.message}`);
    }

  }


  private async getMpdSong() {

    const mpdResponse = await this.mpdClientService.currentsong();
    if (!mpdResponse || !mpdResponse.song || !mpdResponse.song.file) {
      return {};
    }

    const file = mpdResponse.song.file;

    let song: PlaylogDocument | null = null;

    if (file.includes('/qobuz/track/')) {
      const parts = file.split('/trackId/');
      const qobuzId = parts.length > 1 ? parts[1] : null;

      if (qobuzId) {
        song = await this.songModel.findOne({
          source: { $elemMatch: { name: 'qobuz', sourceId: qobuzId } },
        });
      }
    } else {
      song = await this.songModel.findOne({
        source: { $elemMatch: { name: 'file', sourceId: file } },
      });
    }

    return { song, mpdResponse };
  }

  private async fetchPreviousSong() {
    try {
      const lastPlaylog = await this.playlogModel.findOne().sort({ playedAt: -1 }).exec();
      if (lastPlaylog && lastPlaylog.songId) {
        return lastPlaylog.songId.toString();
      }
    } catch (error: any) {
      this.logger.error(`Error initializing last played file from DB: ${error.message}`);
    }
  }

  async handleFeedbackEvent(groupedCounts: Record<string, number>) {

    const { song, mpdResponse } = await this.getMpdSong();

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
