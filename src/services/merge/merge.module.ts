import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MergeFactory } from './merge.factory';
import { MergeService } from './merge.service';
import { SongMerger } from './mergers/song.merger';
import { AlbumMerger } from './mergers/album.merger';
import { ArtistMerger } from './mergers/artist.merger';
import { Song, SongSchema } from '../../schemas/song.schema';
import { Album, AlbumSchema } from '../../schemas/albums.schema';
import { Artist, ArtistSchema } from '../../schemas/artist.schema';
import {
  Deduplication,
  DeduplicationSchema,
} from '../../schemas/deduplication.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Song.name, schema: SongSchema },
      { name: Album.name, schema: AlbumSchema },
      { name: Artist.name, schema: ArtistSchema },
      { name: Deduplication.name, schema: DeduplicationSchema },
    ]),
  ],
  providers: [
    MergeFactory,
    MergeService,
    SongMerger,
    AlbumMerger,
    ArtistMerger,
  ],
  exports: [MergeFactory, MergeService],
})
export class MergeModule {}
