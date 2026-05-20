import { Injectable, Logger } from '@nestjs/common';
import { Merger } from './merger.interface';
import { SongDocument } from '../../../schemas/song.schema';

@Injectable()
export class SongMerger implements Merger<SongDocument> {
  private readonly logger = new Logger(SongMerger.name);

  merge(existingEntity: SongDocument, newEntity: SongDocument): SongDocument {
    this.logger.log(`Merging song ${newEntity.title} into existing song ${existingEntity._id}`);

    // Merge sources
    if (newEntity.source && newEntity.source.length > 0) {
      if (!existingEntity.source) {
        existingEntity.source = [];
      }

      for (const newSource of newEntity.source) {
        const sourceExists = existingEntity.source.some(
          (s) => s.name === newSource.name && s.sourceId === newSource.sourceId,
        );

        if (!sourceExists) {
          existingEntity.source.push(newSource);
        }
      }
    }

    // You can add more specific merge logic here for other properties if needed
    // Example: Update missing fields in existingEntity from newEntity
    
    return existingEntity;
  }
}
