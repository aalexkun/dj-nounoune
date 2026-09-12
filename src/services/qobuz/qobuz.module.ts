import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QobuzService } from './qobuz.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Artist, ArtistSchema } from '../../schemas/artist.schema';
import { Album, AlbumSchema } from '../../schemas/albums.schema';
import { Song, SongSchema } from '../../schemas/song.schema';
import { OpensearchModule } from '../opensearch/opensearch.module';
import { CredentialStoreModule } from '../credential-store/credential-store.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Artist.name, schema: ArtistSchema },
      { name: Album.name, schema: AlbumSchema },
      { name: Song.name, schema: SongSchema },
    ]),
    OpensearchModule,
    CredentialStoreModule,
  ],
  providers: [QobuzService],
  exports: [QobuzService],
})
export class QobuzModule {}
