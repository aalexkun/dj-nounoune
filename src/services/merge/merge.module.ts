import { Module } from '@nestjs/common';
import { MergeFactory } from './merge.factory';
import { SongMerger } from './mergers/song.merger';

@Module({
  providers: [MergeFactory, SongMerger],
  exports: [MergeFactory],
})
export class MergeModule {}
