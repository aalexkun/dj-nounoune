import { Module, ModuleMetadata, Provider } from '@nestjs/common';
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
import { ChatStreamService } from './services/chat/chat-stream.service';
import { ChatTitleService } from './services/chat/chat-title.service';
import { ChatRetentionService } from './services/chat/chat-retention.service';
import { ChatActionService } from './services/chat/chat-action.service';
import { FeedbackService } from './services/feedback/feedback.service';
import { PlaybackControlService } from './services/playback/playback-control.service';
import { QueueStateService } from './services/queue-state/queue-state.service';
import { MpcStateService } from './services/queue-state/mpc-state.service';
import { PlaylistReconcilerService } from './services/queue-state/playlist-reconciler.service';
import { QueueMirrorService } from './services/queue-state/queue-mirror.service';
import { ChatEnvelopeDoc, ChatEnvelopeSchemaDefinition } from './schemas/chat-envelope.schema';
import { ChatController } from './controller/chat.controller';
import { AuthController } from './controller/auth.controller';
import { VibingController } from './controller/vibing.controller';
import { SessionController } from './controller/session.controller';
import { AuthService } from './services/auth/auth.service';
import { User, UserSchema } from './schemas/user.schema';
import { GoogleIdTokenVerifier } from './services/auth/google-id-token.verifier';
import { UserService } from './services/auth/user.service';
import { AuthSessionService } from './services/auth/auth-session.service';
import { SessionAuthGuard } from './services/auth/session-auth.guard';
import { AuthRateLimitGuard } from './services/auth/auth-rate-limit.guard';
import { MpdClientService } from './services/mpd-client/mpd-client.service';
import { SpotifyModule } from './services/spotify/spotify.module';
import { QobuzModule } from './services/qobuz/qobuz.module';
import { YoutubeModule } from './services/youtube/youtube.module';
import { CredentialStoreModule } from './services/credential-store/credential-store.module';
import { PromptusService } from './services/promptus/promptus.service';
import { ToolsService } from './services/promptus/tools.service';
import { SessionService } from './services/session/session.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ElasticsearchModule } from './services/elasticsearch/elasticsearch.module';
import { MergeModule } from './services/merge/merge.module';
import { OpensearchModule } from './services/opensearch/opensearch.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulersModule } from './schedulers/schedulers.module';
import { ChatRetentionScheduler } from './schedulers/chat-retention.scheduler';
import { PlaylogService } from './services/playlog/playlog.service';
import { RedisCacheModule } from './services/redis-cache/redis-cache.module';
import { ProfilerService } from './services/profiler/profiler.service';
import { Playlog, PlaylogSchema } from './schemas/playlog.schema';
import { NegentropyJob, NegentropyJobSchema } from './schemas/negentropy-job.schema';
import { NegentropyService } from './services/negentropy/negentropy.service';
import { WeatherModule } from './services/weather/weather.module';
import { EnrichService } from './services/enrich/enrich.service';
import { DeduplicationService } from './services/deduplication/deduplication.service';
import { EnrichScheduler } from './schedulers/enrich.scheduler';

const imports: NonNullable<ModuleMetadata['imports']> = [
  // Load global env
  ConfigModule.forRoot({
    isGlobal: true,
  }),
  EventEmitterModule.forRoot(),
  MongooseModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => ({
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
    { name: ChatEnvelopeDoc.name, schema: ChatEnvelopeSchemaDefinition },
    { name: Deduplication.name, schema: DeduplicationSchema },
    { name: Enrich.name, schema: EnrichSchema },
    { name: Playlog.name, schema: PlaylogSchema },
    { name: NegentropyJob.name, schema: NegentropyJobSchema },
    { name: User.name, schema: UserSchema },
  ]),
  MpdClientModule,
  SpotifyModule,
  QobuzModule,
  YoutubeModule,
  // Also imported by the three provider modules; here because `auth import-sessions` is a root
  // provider, and a root provider only sees what a root import exports.
  CredentialStoreModule,
  ElasticsearchModule,
  MergeModule,
  OpensearchModule,
  RedisCacheModule,
  WeatherModule,
];

const providers: Provider[] = [
  AppService,
  PromptusService,
  PsvService,
  ...CommandProviders,
  ChatService,
  ChatStreamService,
  ChatTitleService,
  ChatRetentionService,
  ChatActionService,
  FeedbackService,
  PlaybackControlService,
  // The @Interval on QueueStateService is inert under IS_CLI, where ScheduleModule is never
  // imported — so the three consumers below simply never see a snapshot and do nothing.
  QueueStateService,
  MpcStateService,
  QueueMirrorService,
  PlaylistReconcilerService,
  ShellService,
  MusicDbService,
  MpdClientService,
  FileService,
  ChatGateway,
  VibingGateway,
  ToolsService,
  AuthService,
  // Google sign-in and the sessions it mints. SessionAuthGuard accepts a bearer token and, while
  // AUTHX_API_KEY_ENABLED=true (off by default), the legacy x-api-key pair beside it — so both are live during
  // the rollout and the cutover is deleting one flag, not a code change.
  GoogleIdTokenVerifier,
  UserService,
  AuthSessionService,
  SessionAuthGuard,
  AuthRateLimitGuard,
  SessionService,
  ProfilerService,
  PlaylogService,
  NegentropyService,
  EnrichService,
  // Root for the same reason as EnrichService: it needs AppService and ToolsService.
  DeduplicationService,
];

if (process.env.IS_CLI !== 'true') {
  imports.push(ScheduleModule.forRoot(), SchedulersModule);
  // Declared here rather than in SchedulersModule because the services they drive are root
  // providers: a child module cannot see them.
  providers.push(EnrichScheduler, ChatRetentionScheduler);
}

@Module({
  imports,
  // SessionController and AuthController share the `auth` prefix on purpose: one signs people in,
  // the other holds the three provider OAuth callbacks. Different concerns, one path segment.
  controllers: [ChatController, AuthController, SessionController, VibingController],
  providers,
})
export class AppModule {}
