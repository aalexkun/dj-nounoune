import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { CommandProviders } from './cli/command.provider';
import { PsvService } from './services/transformation/psv.service';
import { Artist, ArtistSchema } from './schemas/artist.schema';
import { Album, AlbumSchema } from './schemas/albums.schema';
import { Song, SongSchema } from './schemas/song.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import { PromptusService } from './services/promptus/promptus/promptus.service';
import { MusicDbService } from './services/music-db/music-db.service';
import { MpdClientModule } from './services/mpd-client/mpd-client.module';
import { FfprobeService } from './services/ffprobe/ffprobe.service';
import { FileService } from './services/file/file.service';
import { ChatGateway } from './gateway/chat.gateway';
import { Chat, ChatSchema } from './schemas/chat.schema';
import { ChatService } from './services/chat/chat.service';
import { ChatController } from './controller/chat.controller';
import { AuthService } from './services/auth/auth.service';
import { ApiAuthGuard } from './services/auth/api-auth.guard';

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
      { name: Session.name, schema: SessionSchema },
      { name: Chat.name, schema: ChatSchema },
    ]),
    MpdClientModule,
  ],
  controllers: [ChatController],
  providers: [
    AppService,
    PsvService,
    ...CommandProviders,
    PromptusService,
    MusicDbService,
    FfprobeService,
    FileService,
    ChatGateway,
    ChatService,
    AuthService,
    ApiAuthGuard,
  ],
})
export class AppModule {}
