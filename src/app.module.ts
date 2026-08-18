import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { CommandProviders } from './cli/command.provider';
import { PsvService } from './services/transformation/psv.service';
import { Artist, ArtistSchema } from './schemas/artist.schema';
import { Album, AlbumSchema } from './schemas/albums.schema';
import { Song, SongSchema } from './schemas/song.schema';
import { Connection, ConnectionSchema } from './schemas/connection.schema';
import { MusicDbService } from './services/music-db/music-db.service';
import { MpdClientModule } from './services/mpd-client/mpd-client.module';
import { ShellService } from './services/shell/shell.service';
import { FileService } from './services/file/file.service';
import { ChatGateway } from './gateway/chat.gateway';
import { VibingGateway } from './gateway/vibing.gateway';
import { Chat, ChatSchema } from './schemas/chat.schema';
import { Deduplication, DeduplicationSchema } from './schemas/deduplication.schema';
import { Enrich, EnrichSchema } from './schemas/enrich.schema';
import { ChatService } from './services/chat/chat.service';
import { ChatController } from './controller/chat.controller';
import { AuthController } from './controller/auth.controller';
import { VibingController } from './controller/vibing.controller';
import { AuthService } from './services/auth/auth.service';
import { ApiAuthGuard } from './services/auth/api-auth.guard';
import { MpdClientService } from './services/mpd-client/mpd-client.service';
import { SpotifyModule } from './services/spotify/spotify.module';
import { QobuzModule } from './services/qobuz/qobuz.module';
import { PromptusService } from './services/promptus/promptus.service';
import { ToolsService } from './services/promptus/tools.service';
import { SessionService } from './services/session/session.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ElasticsearchModule } from './services/elasticsearch/elasticsearch.module';
import { MergeModule } from './services/merge/merge.module';
import { OpensearchModule } from './services/opensearch/opensearch.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulersModule } from './schedulers/schedulers.module';
import { PlaylogService } from './services/playlog/playlog.service';
import { RedisCacheModule } from './services/redis-cache/redis-cache.module';
import { ProfilerService } from './services/profiler/profiler.service';
import { Playlog, PlaylogSchema } from './schemas/playlog.schema';
import { NegentropyJob, NegentropyJobSchema } from './schemas/negentropy-job.schema';
import { NegentropyService } from './services/negentropy/negentropy.service';
import { WeatherModule } from './services/weather/weather.module';

const imports: Array<any> = [
  // Load global env
  ConfigModule.forRoot({
    isGlobal: true,
  }),
  EventEmitterModule.forRoot(),
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
    { name: Connection.name, schema: ConnectionSchema },
    { name: Chat.name, schema: ChatSchema },
    { name: Deduplication.name, schema: DeduplicationSchema },
    { name: Enrich.name, schema: EnrichSchema },
    { name: Playlog.name, schema: PlaylogSchema },
    { name: NegentropyJob.name, schema: NegentropyJobSchema },
  ]),
  MpdClientModule,
  SpotifyModule,
  QobuzModule,
  ElasticsearchModule,
  MergeModule,
  OpensearchModule,
  RedisCacheModule,
  WeatherModule,
];

if (process.env.IS_CLI !== 'true') {
  imports.push(ScheduleModule.forRoot(), SchedulersModule);
}


@Module({
  imports,
  controllers: [ChatController, AuthController, VibingController],
  providers: [
    AppService,
    PromptusService,
    PsvService,
    ...CommandProviders,
    ChatService,
    ShellService,
    MusicDbService,
    MpdClientService,
    FileService,
    ChatGateway,
    VibingGateway,
    ToolsService,
    AuthService,
    ApiAuthGuard,
    SessionService,
    ProfilerService,
    PlaylogService,
    NegentropyService,
  ],
})
export class AppModule {}
