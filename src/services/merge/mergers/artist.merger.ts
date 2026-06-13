import { Injectable, Logger } from '@nestjs/common';
import { Merger } from './merger.interface';
import { ArtistDocument } from '../../../schemas/artist.schema';
import { ArtistSource } from '../../../schemas/source.schema';
import { resolveFieldValue } from './field-resolver';

@Injectable()
export class ArtistMerger implements Merger<ArtistDocument> {
  private readonly logger = new Logger(ArtistMerger.name);

  merge(
    primaryEntity: ArtistDocument,
    duplicateEntity: ArtistDocument,
  ): ArtistDocument {
    this.logger.log(
      `Merging artist "${duplicateEntity.artist}" (${String(duplicateEntity._id)}) into "${primaryEntity.artist}" (${String(primaryEntity._id)})`,
    );

    const primarySources: ArtistSource[] = primaryEntity.source ?? [];
    const duplicateSources: ArtistSource[] = duplicateEntity.source ?? [];

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

    // 2. Merge albums arrays (union of ObjectIds)
    if (duplicateEntity.albums && duplicateEntity.albums.length > 0) {
      if (!primaryEntity.albums) {
        primaryEntity.albums = [];
      }
      const existingAlbumIds = new Set(
        primaryEntity.albums.map((a) => a.toString()),
      );
      for (const album of duplicateEntity.albums) {
        const albumId = album.toString();
        if (!existingAlbumIds.has(albumId)) {
          primaryEntity.albums.push(album);
          existingAlbumIds.add(albumId);
        }
      }
    }

    // 3. Resolve metadata conflicts
    primaryEntity.artist = resolveFieldValue(
      'artist', primaryEntity.artist, duplicateEntity.artist,
      primarySources, duplicateSources,
    );
    primaryEntity.primary_genres = resolveFieldValue(
      'primary_genres', primaryEntity.primary_genres, duplicateEntity.primary_genres,
      primarySources, duplicateSources,
    );
    primaryEntity.short_intro = resolveFieldValue(
      'short_intro', primaryEntity.short_intro, duplicateEntity.short_intro,
      primarySources, duplicateSources,
    );
    primaryEntity.biography = resolveFieldValue(
      'biography', primaryEntity.biography, duplicateEntity.biography,
      primarySources, duplicateSources,
    );

    return primaryEntity;
  }
}
