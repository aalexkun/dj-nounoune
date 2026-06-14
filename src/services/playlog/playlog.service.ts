import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Playlog, PlaylogDocument } from '../../schemas/playlog.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { MpdClientService } from '../mpd-client/mpd-client.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class PlaylogService implements OnModuleInit {
  private readonly logger = new Logger(PlaylogService.name);
  private lastPlayedFile: string | null = null;
  private currentPlaylogId: Types.ObjectId | null = null;

  constructor(
    @InjectModel(Playlog.name) private playlogModel: Model<PlaylogDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
    private mpdClientService: MpdClientService,
  ) {}

  async onModuleInit() {
    try {
      const lastPlaylog = await this.playlogModel.findOne().sort({ playedAt: -1 }).exec();
      if (lastPlaylog) {
        const fileMatch = lastPlaylog.raw.match(/^file:\s*(.*)$/m);
        if (fileMatch && fileMatch[1]) {
          this.lastPlayedFile = fileMatch[1];
          this.currentPlaylogId = lastPlaylog._id;
          this.logger.log(`Initialized last played file from DB: ${this.lastPlayedFile}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`Error initializing last played file from DB: ${error.message}`);
    }
  }

  @Interval(10000)
  async checkCurrentSong() {
    try {
      const currentSongResponse = await this.mpdClientService.currentsong();
      if (!currentSongResponse || !currentSongResponse.song || !currentSongResponse.song.file) {
        return;
      }

      const file = currentSongResponse.song.file;

      if (file !== this.lastPlayedFile) {
        this.logger.log(`New song detected: ${file}`);
        this.lastPlayedFile = file;

        let songId: Types.ObjectId | undefined;
        
        // Find matching song in the DB
        if (file.includes('/qobuz/track/')) {
          const parts = file.split('/trackId/');
          const qobuzId = parts.length > 1 ? parts[1] : null;
          
          if (qobuzId) {
            const song = await this.songModel.findOne({
              source: { $elemMatch: { name: 'qobuz', sourceId: qobuzId } }
            });
            if (song) {
              songId = song._id;
            }
          }
        } else {
          // File path matching
          const song = await this.songModel.findOne({
            source: { $elemMatch: { name: 'file',  sourceId: file } },
          });
          if (song) {
            songId = song._id;
          }
        }

        const newPlaylog = new this.playlogModel({
          playedAt: new Date(),
          raw: currentSongResponse.rawResponse,
          title: currentSongResponse.song.title,
          artist: currentSongResponse.song.artist,
          album: currentSongResponse.song.album,
          songId: songId,
        });

        const savedPlaylog = await newPlaylog.save();
        this.currentPlaylogId = savedPlaylog._id;
        this.logger.log(`Created new playlog entry: ${savedPlaylog._id}`);
      }
    } catch (error: any) {
      this.logger.error(`Error checking current song: ${error.message}`);
    }
  }

  @OnEvent('chat.feedback.received')
  async handleFeedbackEvent(groupedCounts: Record<string, number>) {
    if (!this.currentPlaylogId) {
      this.logger.warn(`Feedback received but no active playlog session: ${JSON.stringify(groupedCounts)}`);
      return;
    }

    const validFeedbackTypes = ['awesome', 'wtf', 'great', 'boring'];
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
      await this.playlogModel.updateOne(
        { _id: this.currentPlaylogId },
        { $inc: updateQuery }
      );
      this.logger.log(`Incremented feedback counts for playlog ${this.currentPlaylogId}`);
    } catch (error: any) {
      this.logger.error(`Error updating playlog feedback: ${error.message}`);
    }
  }
}
