import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { MergeFactory } from './merge.factory';
import { OpensearchService } from '../opensearch/opensearch.service';
import { PopulatedSong } from '../music-db/music-db.service';
import { isSameEntityName } from '../deduplication/duplicate-score.util';

@Injectable()
export class MergeService {
  private readonly logger = new Logger(MergeService.name);

  constructor(
    @InjectModel(Song.name)
    private readonly songModel: Model<SongDocument>,
    @InjectModel(Album.name)
    private readonly albumModel: Model<AlbumDocument>,
    @InjectModel(Artist.name)
    private readonly artistModel: Model<ArtistDocument>,
    private readonly mergeFactory: MergeFactory,
    private readonly opensearchService: OpensearchService,
  ) {}

  /**
   * Merges a duplicate track into the primary track, cascading into album and artist merges
   * when the referenced ids differ **and the names agree**. After merging, hard-deletes the
   * duplicate. Recording the outcome on the dedup group is the caller's job.
   *
   * The cascade is guarded because it is the expensive part of a wrong merge: two songs judged
   * the same recording is one document lost, but merging their artists re-points whole
   * discographies. So an artist or album merge needs its own identity check
   * (`isSameEntityName`); when the names do not pass, the duplicate song is folded into the
   * primary and its artist and album are left exactly as they were.
   */
  async mergeDuplicateTracks(primaryId: string, duplicateId: string): Promise<void> {
    this.logger.log(`Merging duplicate track ${duplicateId} into primary ${primaryId}`);

    let primary = await this.songModel.findById(primaryId);
    let duplicate = await this.songModel.findById(duplicateId);

    if (!primary) {
      throw new Error(`Primary song not found: ${primaryId}`);
    }
    if (!duplicate) {
      this.logger.warn(`Duplicate song ${duplicateId} not found — may have been deleted already. Skipping.`);
      return;
    }

    // The album the duplicate came from, before any cascade re-points it: its tracks array has to
    // lose the song whether or not the album itself is merged.
    const originalDuplicateAlbumId = duplicate.album;

    // 1. Recursive cascade: merge artists first
    const primaryArtistId = primary.artist.toString();
    const duplicateArtistId = duplicate.artist.toString();
    if (primaryArtistId !== duplicateArtistId) {
      if (await this.namesAgree('artist', primaryArtistId, duplicateArtistId)) {
        await this.mergeDuplicateArtists(primaryArtistId, duplicateArtistId);
        // Reload songs as they might have been re-pointed
        primary = await this.songModel.findById(primaryId);
        duplicate = await this.songModel.findById(duplicateId);
        if (!primary || !duplicate) {
          throw new Error('Songs disappeared during artist merge');
        }
      } else {
        this.logger.warn(`Artists ${primaryArtistId} and ${duplicateArtistId} are not the same name; the song is merged, the artists are left apart`);
      }
    }

    // 2. Recursive cascade: merge albums second
    const primaryAlbumId = primary.album.toString();
    const duplicateAlbumId = duplicate.album.toString();
    if (primaryAlbumId !== duplicateAlbumId) {
      if (await this.namesAgree('album', primaryAlbumId, duplicateAlbumId)) {
        await this.mergeDuplicateAlbums(primaryAlbumId, duplicateAlbumId);
        // Reload songs as they might have been re-pointed
        primary = await this.songModel.findById(primaryId);
        duplicate = await this.songModel.findById(duplicateId);
        if (!primary || !duplicate) {
          throw new Error('Songs disappeared during album merge');
        }
      } else {
        this.logger.warn(`Albums ${primaryAlbumId} and ${duplicateAlbumId} are not the same record; the song is merged, the albums are left apart`);
      }
    }

    // 3. Song level merge
    const merger = this.mergeFactory.getMerger('song');
    const merged = await merger.merge(primary, duplicate);
    await merged.save();

    // Hard delete duplicate song
    await this.songModel.findByIdAndDelete(duplicateId);
    this.logger.log(`Deleted duplicate song ${duplicateId}`);

    // Remove the duplicate song from every tracks array that held it: the primary's album (which
    // the cascade may have merged it into) and the album it originally sat on (which may not).
    await this.albumModel.updateMany(
      { _id: { $in: [primary.album, originalDuplicateAlbumId] } },
      { $pull: { tracks: new Types.ObjectId(duplicateId) } },
    );

    // Rebuild the survivor's index entry from what was just saved. The merger only ever removed
    // the duplicate's document; the primary's merged title, sources and lyric distillation would
    // otherwise sit in the index exactly as they were before the merge.
    const populatedPrimary = await this.songModel.findById(primaryId).populate('artist').populate('album').exec();
    if (populatedPrimary) {
      await this.opensearchService.indexSong(populatedPrimary as unknown as PopulatedSong);
    }
  }

  /** Whether two artist or album documents carry the same name, by the dedup identity rule. */
  private async namesAgree(kind: 'artist' | 'album', primaryId: string, duplicateId: string): Promise<boolean> {
    if (kind === 'artist') {
      const [primary, duplicate] = await Promise.all([this.artistModel.findById(primaryId), this.artistModel.findById(duplicateId)]);
      return !!primary && !!duplicate && isSameEntityName(primary.artist ?? '', duplicate.artist ?? '', 'artist');
    }

    const [primary, duplicate] = await Promise.all([this.albumModel.findById(primaryId), this.albumModel.findById(duplicateId)]);
    return !!primary && !!duplicate && isSameEntityName(primary.title ?? '', duplicate.title ?? '', 'album');
  }

  /**
   * Merges a duplicate album into the primary album.
   * Re-points any songs still referencing the duplicate, and cleans up
   * the duplicate album ID from its artist's albums array.
   */
  async mergeDuplicateAlbums(primaryId: string, duplicateId: string): Promise<void> {
    this.logger.log(`Merging duplicate album ${duplicateId} into primary ${primaryId}`);

    const primary = await this.albumModel.findById(primaryId);
    const duplicate = await this.albumModel.findById(duplicateId);

    if (!primary) {
      throw new Error(`Primary album not found: ${primaryId}`);
    }
    if (!duplicate) {
      this.logger.warn(`Duplicate album ${duplicateId} not found — may have been deleted already. Skipping.`);
      return;
    }

    // Merge via factory
    const merger = this.mergeFactory.getMerger('album');
    const merged = await merger.merge(primary, duplicate);
    await merged.save();

    // Hard delete duplicate album
    await this.albumModel.findByIdAndDelete(duplicateId);
    this.logger.log(`Deleted duplicate album ${duplicateId}`);

    // Re-point any songs still referencing the duplicate album to the primary
    const songRePoint = await this.songModel.updateMany(
      { album: new Types.ObjectId(duplicateId) },
      { $set: { album: new Types.ObjectId(primaryId) } },
    );
    if (songRePoint.modifiedCount > 0) {
      this.logger.log(`Re-pointed ${songRePoint.modifiedCount} song(s) from album ${duplicateId} to ${primaryId}`);
    }

    // Remove duplicate album from its artist's albums array
    await this.artistModel.updateOne({ albums: new Types.ObjectId(duplicateId) }, { $pull: { albums: new Types.ObjectId(duplicateId) } });
  }

  /**
   * Merges a duplicate artist into the primary artist.
   * Re-points any songs and albums still referencing the duplicate.
   */
  async mergeDuplicateArtists(primaryId: string, duplicateId: string): Promise<void> {
    this.logger.log(`Merging duplicate artist ${duplicateId} into primary ${primaryId}`);

    const primary = await this.artistModel.findById(primaryId);
    const duplicate = await this.artistModel.findById(duplicateId);

    if (!primary) {
      throw new Error(`Primary artist not found: ${primaryId}`);
    }
    if (!duplicate) {
      this.logger.warn(`Duplicate artist ${duplicateId} not found — may have been deleted already. Skipping.`);
      return;
    }

    // Merge via factory
    const merger = this.mergeFactory.getMerger('artist');
    const merged = await merger.merge(primary, duplicate);
    await merged.save();

    // Hard delete duplicate artist
    await this.artistModel.findByIdAndDelete(duplicateId);
    this.logger.log(`Deleted duplicate artist ${duplicateId}`);

    // Re-point any songs referencing the duplicate artist
    const songRePoint = await this.songModel.updateMany(
      { artist: new Types.ObjectId(duplicateId) },
      { $set: { artist: new Types.ObjectId(primaryId) } },
    );
    if (songRePoint.modifiedCount > 0) {
      this.logger.log(`Re-pointed ${songRePoint.modifiedCount} song(s) from artist ${duplicateId} to ${primaryId}`);
    }

    // Re-point any albums referencing the duplicate artist
    const albumRePoint = await this.albumModel.updateMany(
      { artist: new Types.ObjectId(duplicateId) },
      { $set: { artist: new Types.ObjectId(primaryId) } },
    );
    if (albumRePoint.modifiedCount > 0) {
      this.logger.log(`Re-pointed ${albumRePoint.modifiedCount} album(s) from artist ${duplicateId} to ${primaryId}`);
    }
  }
}
