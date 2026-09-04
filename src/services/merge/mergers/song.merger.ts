import { Injectable, Logger } from '@nestjs/common';
import { resolveFieldValue } from './field-resolver';
import { SongDocument } from '../../../schemas/song.schema';
import { Merger } from './merger.interface';
import { Source } from '../../../schemas/source.schema';
import { OpensearchService } from '../../opensearch/opensearch.service';


@Injectable()
export class SongMerger implements Merger<SongDocument> {
  private readonly logger = new Logger(SongMerger.name);

  constructor(private readonly opensearchService: OpensearchService) {}

  async merge(
    primaryEntity: SongDocument,
    duplicateEntity: SongDocument,
  ): Promise<SongDocument> {
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
    // Without this a duplicate that had already been distilled would lose its sentence on merge,
    // and the survivor would have to wait for the enricher to reach it again.
    primaryEntity.lyric_semantic = resolveFieldValue(
      'lyric_semantic', primaryEntity.lyric_semantic, duplicateEntity.lyric_semantic,
      primarySources, duplicateSources,
    );

    // 3. Remove the merged (duplicate) song document from the OpenSearch index.
    // The song's id is used as the OpenSearch document id.
    await this.opensearchService.deleteSong(String(duplicateEntity._id));

    return primaryEntity;
  }
}
