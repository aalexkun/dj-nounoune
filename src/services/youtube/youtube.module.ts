import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { YoutubeService } from './youtube.service';
import { Artist, ArtistSchema } from '../../schemas/artist.schema';
import { Album, AlbumSchema } from '../../schemas/albums.schema';
import { Song, SongSchema } from '../../schemas/song.schema';
import { OpensearchModule } from '../opensearch/opensearch.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Artist.name, schema: ArtistSchema },
      { name: Album.name, schema: AlbumSchema },
      { name: Song.name, schema: SongSchema },
    ]),
    OpensearchModule,
  ],
  providers: [YoutubeService],
  exports: [YoutubeService],
})
export class YoutubeModule {}
