import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Playlog, PlaylogSchema } from '../../schemas/playlog.schema';
import { Song, SongSchema } from '../../schemas/song.schema';
import { PlaylogService } from './playlog.service';
import { MpdClientModule } from '../mpd-client/mpd-client.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Playlog.name, schema: PlaylogSchema },
      { name: Song.name, schema: SongSchema },
    ]),
    MpdClientModule,
  ],
  providers: [PlaylogService],
  exports: [PlaylogService],
})
export class PlaylogModule {}
