import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { Merger } from './merger.interface.js';
import { AlbumDocument } from '../../../schemas/albums.schema.js';
import { AlbumSource } from '../../../schemas/source.schema.js';
import { resolveFieldValue } from './field-resolver.js';

@Injectable()
export class AlbumMerger implements Merger<AlbumDocument> {
  private readonly logger = new Logger(AlbumMerger.name);

  merge(
    primaryEntity: AlbumDocument,
    duplicateEntity: AlbumDocument,
  ): AlbumDocument {
    this.logger.log(
      `Merging album "${duplicateEntity.title}" (${String(duplicateEntity._id)}) into "${primaryEntity.title}" (${String(primaryEntity._id)})`,
    );


    const primarySources: AlbumSource[] = primaryEntity.source ?? [];
    const duplicateSources: AlbumSource[] = duplicateEntity.source ?? [];

    // 2. Merge tracks arrays (union of ObjectIds)
    if (duplicateEntity.tracks && duplicateEntity.tracks.length > 0) {
      if (!primaryEntity.tracks) {
        primaryEntity.tracks = [];
      }
      const existingTrackIds = new Set(
        primaryEntity.tracks.map((t) =>
          (t as unknown as Types.ObjectId).toString(),
        ),
      );
      for (const track of duplicateEntity.tracks) {
        const trackId = (track as unknown as Types.ObjectId).toString();
        if (!existingTrackIds.has(trackId)) {
          primaryEntity.tracks.push(track);
          existingTrackIds.add(trackId);
        }
      }
    }

    // 3. Resolve metadata conflicts via source-priority rules
    primaryEntity.title = resolveFieldValue(
      'title', primaryEntity.title, duplicateEntity.title,
      primarySources, duplicateSources,
    );
    primaryEntity.release_year = resolveFieldValue(
      'release_year', primaryEntity.release_year, duplicateEntity.release_year,
      primarySources, duplicateSources,
    );
    primaryEntity.genre = resolveFieldValue(
      'genre', primaryEntity.genre, duplicateEntity.genre,
      primarySources, duplicateSources,
    );
    primaryEntity.record_label = resolveFieldValue(
      'record_label', primaryEntity.record_label, duplicateEntity.record_label,
      primarySources, duplicateSources,
    );
    primaryEntity.catalogue_number = resolveFieldValue(
      'catalogue_number', primaryEntity.catalogue_number, duplicateEntity.catalogue_number,
      primarySources, duplicateSources,
    );
    primaryEntity.subtitle = resolveFieldValue(
      'subtitle', primaryEntity.subtitle, duplicateEntity.subtitle,
      primarySources, duplicateSources,
    );
    primaryEntity.description = resolveFieldValue(
      'description', primaryEntity.description, duplicateEntity.description,
      primarySources, duplicateSources,
    );
    primaryEntity.release_date_original = resolveFieldValue(
      'release_date_original', primaryEntity.release_date_original, duplicateEntity.release_date_original,
      primarySources, duplicateSources,
    );

    // Numeric fields — standard priority (prefer qobuz)
    primaryEntity.total_duration = resolveFieldValue(
      'total_duration', primaryEntity.total_duration, duplicateEntity.total_duration,
      primarySources, duplicateSources,
    );
    primaryEntity.album_gain = resolveFieldValue(
      'album_gain', primaryEntity.album_gain, duplicateEntity.album_gain,
      primarySources, duplicateSources,
    );
    primaryEntity.rating = resolveFieldValue(
      'rating', primaryEntity.rating, duplicateEntity.rating,
      primarySources, duplicateSources,
    );
    primaryEntity.track_count = resolveFieldValue(
      'track_count', primaryEntity.track_count, duplicateEntity.track_count,
      primarySources, duplicateSources,
    );
    primaryEntity.is_complete = resolveFieldValue(
      'is_complete', primaryEntity.is_complete, duplicateEntity.is_complete,
      primarySources, duplicateSources,
    );

    // Languages — union of string arrays
    if (duplicateEntity.languages && duplicateEntity.languages.length > 0) {
      if (!primaryEntity.languages) {
        primaryEntity.languages = [];
      }
      const existingLangs = new Set(primaryEntity.languages);
      for (const lang of duplicateEntity.languages) {
        if (!existingLangs.has(lang)) {
          primaryEntity.languages.push(lang);
          existingLangs.add(lang);
        }
      }
    }

    // Image — prefer the more complete image object; fallback to qobuz preference
    primaryEntity.image = this.mergeImage(
      primaryEntity.image,
      duplicateEntity.image,
      primarySources,
      duplicateSources,
    );

    return primaryEntity;
  }

  private mergeImage(
    primaryImage: AlbumDocument['image'],
    duplicateImage: AlbumDocument['image'],
    primarySources: AlbumSource[],
    duplicateSources: AlbumSource[],
  ): AlbumDocument['image'] {
    if (!primaryImage && !duplicateImage) return primaryImage;
    if (!primaryImage) return duplicateImage;
    if (!duplicateImage) return primaryImage;

    const countNonEmpty = (
      img: NonNullable<AlbumDocument['image']>,
    ): number => {
      return [img.small, img.thumbnail, img.large, img.back].filter(Boolean)
        .length;
    };

    const primaryCount = countNonEmpty(primaryImage);
    const duplicateCount = countNonEmpty(duplicateImage);

    if (duplicateCount > primaryCount) return duplicateImage;
    if (primaryCount > duplicateCount) return primaryImage;

    // Tied — prefer qobuz source
    const primaryHasQobuz = primarySources.some((s) => s.name === 'qobuz');
    if (primaryHasQobuz) return primaryImage;
    return duplicateImage;
  }
}
