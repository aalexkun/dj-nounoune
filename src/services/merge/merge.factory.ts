import { Injectable, Logger } from '@nestjs/common';
import { SongMerger } from './mergers/song.merger';
import { Merger } from './mergers/merger.interface';
import { SongDocument } from '../../schemas/song.schema';

@Injectable()
export class MergeFactory {
  private readonly logger = new Logger(MergeFactory.name);

  constructor(
    private readonly songMerger: SongMerger,
    // Add other mergers here (ArtistMerger, AlbumMerger) in the future
  ) {}

  getMerger(type: 'song' | 'artist' | 'album'): Merger<any> {
    switch (type) {
      case 'song':
        return this.songMerger;
      case 'artist':
      case 'album':
        this.logger.warn(`Merger for type ${type} is not yet implemented.`);
        throw new Error(`Merger for type ${type} is not yet implemented.`);
      default:
        throw new Error(`Unknown merger type: ${type}`);
    }
  }
}
