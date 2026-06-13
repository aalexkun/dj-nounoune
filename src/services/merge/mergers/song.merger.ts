import { Injectable, Logger } from '@nestjs/common';
import { resolveFieldValue } from './field-resolver.js';
import { SongDocument } from '../../../schemas/song.schema.js';
import { Merger } from './merger.interface.js';
import { Source } from '../../../schemas/source.schema.js';


@Injectable()
export class SongMerger implements Merger<SongDocument> {
  private readonly logger = new Logger(SongMerger.name);

  merge(
    primaryEntity: SongDocument,
    duplicateEntity: SongDocument,
  ): SongDocument {
    this.logger.log(
      `Merging song "${duplicateEntity.title}" (${String(duplicateEntity._id)}) into "${primaryEntity.title}" (${String(primaryEntity._id)})`,
    );

    const primarySources: Source[] = primaryEntity.source ?? [];
    const duplicateSources: Source[] = duplicateEntity.source ?? [];

    // 1. Merge source arrays (dedup by name + sourceId)
    if (duplicateEntity.source && duplicateEntity.source.length > 0) {
      if (!primaryEntity.source) {
        primaryEntity.source = [];
      }

      for (const newSource of duplicateEntity.source) {
        const sourceExists = primaryEntity.source.some(
          (s) => s.name === newSource.name && s.sourceId === newSource.sourceId,
        );

        if (!sourceExists) {
          primaryEntity.source.push(newSource);
        }
      }
    }

    // 2. Resolve metadata conflicts via source-priority rules
    primaryEntity.title = resolveFieldValue(
      'title', primaryEntity.title, duplicateEntity.title,
      primarySources, duplicateSources,
    );
    primaryEntity.genre = resolveFieldValue(
      'genre', primaryEntity.genre, duplicateEntity.genre,
      primarySources, duplicateSources,
    );
    primaryEntity.year = resolveFieldValue(
      'year', primaryEntity.year, duplicateEntity.year,
      primarySources, duplicateSources,
    );
    primaryEntity.track_number = resolveFieldValue(
      'track_number', primaryEntity.track_number, duplicateEntity.track_number,
      primarySources, duplicateSources,
    );
    primaryEntity.disc_number = resolveFieldValue(
      'disc_number', primaryEntity.disc_number, duplicateEntity.disc_number,
      primarySources, duplicateSources,
    );
    primaryEntity.composer = resolveFieldValue(
      'composer', primaryEntity.composer, duplicateEntity.composer,
      primarySources, duplicateSources,
    );
    primaryEntity.album_artist = resolveFieldValue(
      'album_artist', primaryEntity.album_artist, duplicateEntity.album_artist,
      primarySources, duplicateSources,
    );
    primaryEntity.category = resolveFieldValue(
      'category', primaryEntity.category, duplicateEntity.category,
      primarySources, duplicateSources,
    );

    return primaryEntity;
  }
}
