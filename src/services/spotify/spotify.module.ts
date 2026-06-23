import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SpotifyService } from './spotify.service';
import { Artist, ArtistSchema } from '../../schemas/artist.schema';
import { Album, AlbumSchema } from '../../schemas/albums.schema';
import { Song, SongSchema } from '../../schemas/song.schema';
import { OpensearchModule } from '../opensearch/opensearch.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Artist.name, schema: ArtistSchema },
      { name: Album.name, schema: AlbumSchema },
      { name: Song.name, schema: SongSchema },
    ]),
    OpensearchModule,
  ],
  providers: [SpotifyService],
  exports: [SpotifyService],
})
export class SpotifyModule {}
