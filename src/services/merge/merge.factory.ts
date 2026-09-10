import { Injectable, Logger } from '@nestjs/common';
import { Merger } from './mergers/merger.interface';
import { SongDocument } from '../../schemas/song.schema';
import { AlbumDocument } from '../../schemas/albums.schema';
import { ArtistDocument } from '../../schemas/artist.schema';
import { SongMerger } from './mergers/song.merger';
import { AlbumMerger } from './mergers/album.merger';
import { ArtistMerger } from './mergers/artist.merger';

@Injectable()
export class MergeFactory {
  private readonly logger = new Logger(MergeFactory.name);

  constructor(
    private readonly songMerger: SongMerger,
    private readonly albumMerger: AlbumMerger,
    private readonly artistMerger: ArtistMerger,
  ) {}

  getMerger(type: 'song'): Merger<SongDocument>;
  getMerger(type: 'album'): Merger<AlbumDocument>;
  getMerger(type: 'artist'): Merger<ArtistDocument>;
  getMerger(type: 'song' | 'album' | 'artist'): Merger<SongDocument> | Merger<AlbumDocument> | Merger<ArtistDocument> {
    switch (type) {
      case 'song':
        return this.songMerger;
      case 'album':
        return this.albumMerger;
      case 'artist':
        return this.artistMerger;
      default:
        throw new Error(`Unknown merger type: ${type as string}`);
    }
  }
}
