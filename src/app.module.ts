import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { LogService } from './services/logger.service';
import { CommandProviders } from './cli/command.provider';
import { PsvService } from './services/transformation/psv.service';
import { Artist, ArtistSchema } from './schemas/artist.schema';
import { Album, AlbumSchema } from './schemas/albums.schema';
import { Song, SongSchema } from './schemas/song.schema';
import { PromptusService } from './services/promptus/promptus/promptus.service';

@Module({
  imports: [
    // Load global env
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: configService.get<string>('MONGO_DATABASE'),
      }),
    }),
    MongooseModule.forFeature([
      { name: Artist.name, schema: ArtistSchema },
      { name: Album.name, schema: AlbumSchema },
      { name: Song.name, schema: SongSchema },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService, PsvService, LogService, ...CommandProviders, PromptusService],
})
export class AppModule {}
