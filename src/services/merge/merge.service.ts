import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import {
  Deduplication,
  DeduplicationDocument,
} from '../../schemas/deduplication.schema';
import { MergeFactory } from './merge.factory';

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
    @InjectModel(Deduplication.name)
    private readonly deduplicationModel: Model<DeduplicationDocument>,
    private readonly mergeFactory: MergeFactory,
  ) {}

  /**
   * Merges a duplicate track into the primary track, cascading into
   * album and artist merges when the referenced IDs differ.
   * After merging, hard-deletes the duplicate and updates the dedup tracker.
   */
  async mergeDuplicateTracks(
    primaryId: string,
    duplicateId: string,
    deduplicationDocId: string,
  ): Promise<void> {
    this.logger.log(
      `Merging duplicate track ${duplicateId} into primary ${primaryId}`,
    );

    let primary = await this.songModel.findById(primaryId);
    let duplicate = await this.songModel.findById(duplicateId);

    if (!primary) {
      throw new Error(`Primary song not found: ${primaryId}`);
    }
    if (!duplicate) {
      this.logger.warn(
        `Duplicate song ${duplicateId} not found — may have been deleted already. Skipping.`,
      );
      return;
    }

    // 1. Recursive cascade: merge artists first
    const primaryArtistId = primary.artist.toString();
    const duplicateArtistId = duplicate.artist.toString();
    if (primaryArtistId !== duplicateArtistId) {
      await this.mergeDuplicateArtists(primaryArtistId, duplicateArtistId);
      // Reload songs as they might have been re-pointed
      primary = await this.songModel.findById(primaryId);
      duplicate = await this.songModel.findById(duplicateId);
      if (!primary || !duplicate) {
        throw new Error('Songs disappeared during artist merge');
      }
    }

    // 2. Recursive cascade: merge albums second
    const primaryAlbumId = primary.album.toString();
    const duplicateAlbumId = duplicate.album.toString();
    if (primaryAlbumId !== duplicateAlbumId) {
      await this.mergeDuplicateAlbums(primaryAlbumId, duplicateAlbumId);
      // Reload songs as they might have been re-pointed
      primary = await this.songModel.findById(primaryId);
      duplicate = await this.songModel.findById(duplicateId);
      if (!primary || !duplicate) {
        throw new Error('Songs disappeared during album merge');
      }
    }

    // 3. Song level merge
    const merger = this.mergeFactory.getMerger('song');
    const merged = merger.merge(primary, duplicate);
    await merged.save();

    // Hard delete duplicate song
    await this.songModel.findByIdAndDelete(duplicateId);
    this.logger.log(`Deleted duplicate song ${duplicateId}`);

    // Remove duplicate song from its album's tracks array
    // Since albums might have been merged, the duplicate song's album is now the same as the primary's
    await this.albumModel.updateOne(
      { _id: primary.album },
      { $pull: { tracks: new Types.ObjectId(duplicateId) } },
    );

    // Update dedup tracker status
    await this.deduplicationModel.findByIdAndUpdate(deduplicationDocId, {
      $set: { status: 'completed' },
    });

    this.logger.log(
      `Deduplication ${deduplicationDocId} marked as completed`,
    );
  }

  /**
   * Merges a duplicate album into the primary album.
   * Re-points any songs still referencing the duplicate, and cleans up
   * the duplicate album ID from its artist's albums array.
   */
  async mergeDuplicateAlbums(
    primaryId: string,
    duplicateId: string,
  ): Promise<void> {
    this.logger.log(
      `Merging duplicate album ${duplicateId} into primary ${primaryId}`,
    );

    const primary = await this.albumModel.findById(primaryId);
    const duplicate = await this.albumModel.findById(duplicateId);

    if (!primary) {
      throw new Error(`Primary album not found: ${primaryId}`);
    }
    if (!duplicate) {
      this.logger.warn(
        `Duplicate album ${duplicateId} not found — may have been deleted already. Skipping.`,
      );
      return;
    }

    // Merge via factory
    const merger = this.mergeFactory.getMerger('album');
    const merged = merger.merge(primary, duplicate);
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
      this.logger.log(
        `Re-pointed ${songRePoint.modifiedCount} song(s) from album ${duplicateId} to ${primaryId}`,
      );
    }

    // Remove duplicate album from its artist's albums array
    await this.artistModel.updateOne(
      { albums: new Types.ObjectId(duplicateId) },
      { $pull: { albums: new Types.ObjectId(duplicateId) } },
    );
  }

  /**
   * Merges a duplicate artist into the primary artist.
   * Re-points any songs and albums still referencing the duplicate.
   */
  async mergeDuplicateArtists(
    primaryId: string,
    duplicateId: string,
  ): Promise<void> {
    this.logger.log(
      `Merging duplicate artist ${duplicateId} into primary ${primaryId}`,
    );

    const primary = await this.artistModel.findById(primaryId);
    const duplicate = await this.artistModel.findById(duplicateId);

    if (!primary) {
      throw new Error(`Primary artist not found: ${primaryId}`);
    }
    if (!duplicate) {
      this.logger.warn(
        `Duplicate artist ${duplicateId} not found — may have been deleted already. Skipping.`,
      );
      return;
    }

    // Merge via factory
    const merger = this.mergeFactory.getMerger('artist');
    const merged = merger.merge(primary, duplicate);
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
      this.logger.log(
        `Re-pointed ${songRePoint.modifiedCount} song(s) from artist ${duplicateId} to ${primaryId}`,
      );
    }

    // Re-point any albums referencing the duplicate artist
    const albumRePoint = await this.albumModel.updateMany(
      { artist: new Types.ObjectId(duplicateId) },
      { $set: { artist: new Types.ObjectId(primaryId) } },
    );
    if (albumRePoint.modifiedCount > 0) {
      this.logger.log(
        `Re-pointed ${albumRePoint.modifiedCount} album(s) from artist ${duplicateId} to ${primaryId}`,
      );
    }
  }
}
