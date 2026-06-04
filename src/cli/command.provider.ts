import { ImportCommand } from './music/import.command';
import { ClearCommand } from './music/clear.command';
import { PromptusSearchCommand } from './promptus/search.command';
import { MpdCommand } from './mpd/mpd.command';
import { TestMpdSubCommand } from './mpd/test.subcommand';
import { AddMpdSubCommand } from './mpd/add.subcommand';
import { PlayMpdSubCommand } from './mpd/play.subcommand';
import { ClearMpdSubCommand } from './mpd/clear.subcommand';
import { ShuffleMpdSubCommand } from './mpd/shuffle.subcommand';
import { PlaylistMpdSubCommand } from './mpd/playlist.subcommand';
import { PromptusPlaySubcommand } from './promptus/play.subcommand';
import { PromptusCommand } from './promptus/promptus.command';
import { MusicCommand } from './music/music.command';
import { EnrichCommand } from './music/enrich.command';
import { MigrateTechnicalInfoCommand } from './music/migrate-technical-info.command';
import { PromptusChatSubcommand } from './promptus/chat.subcommand';
import { SpotifyCommand } from './spotify/spotify.command';
import { SpotifyAuthSubCommand } from './spotify/auth.subcommand';
import { QobuzCommand } from './qobuz/qobuz.command';
import { QobuzFavoritesSubCommand } from './qobuz/favorites.subcommand';
import { QobuzFavoriteAlbumsSubCommand } from './qobuz/favorite-albums.subcommand';
import { QobuzAuthSubCommand } from './qobuz/auth.subcommand';
import { QobuzImportFavoriteAlbumsSubCommand } from './qobuz/import-favorite-albums.subcommand';
import { ElasticCommand } from './elastic/elastic.command';
import { ElasticCreateIndexSubCommand } from './elastic/create-index.subcommand';
import { ElasticPruneIndexSubCommand } from './elastic/prune-index.subcommand';
import { ElasticIndexSongsSubCommand } from './elastic/index-songs.subcommand';
import { OpensearchCommand } from './opensearch/opensearch.command';
import { OpensearchCreateIndexSubCommand } from './opensearch/create-index.subcommand';
import { OpensearchPruneIndexSubCommand } from './opensearch/prune-index.subcommand';
import { OpensearchIndexSongsSubCommand } from './opensearch/index-songs.subcommand';

export const CommandProviders = [
  MusicCommand,
  ImportCommand,
  ClearCommand,
  EnrichCommand,
  MigrateTechnicalInfoCommand,

  MpdCommand,
  TestMpdSubCommand,
  AddMpdSubCommand,
  PlayMpdSubCommand,
  ClearMpdSubCommand,
  ShuffleMpdSubCommand,
  PlaylistMpdSubCommand,

  PromptusCommand,
  PromptusPlaySubcommand,
  PromptusSearchCommand,
  PromptusChatSubcommand,

  SpotifyCommand,
  SpotifyAuthSubCommand,

  QobuzCommand,
  QobuzFavoritesSubCommand,
  QobuzFavoriteAlbumsSubCommand,
  QobuzImportFavoriteAlbumsSubCommand,
  QobuzAuthSubCommand,

  ElasticCommand,
  ElasticCreateIndexSubCommand,
  ElasticPruneIndexSubCommand,
  ElasticIndexSongsSubCommand,

  OpensearchCommand,
  OpensearchCreateIndexSubCommand,
  OpensearchPruneIndexSubCommand,
  OpensearchIndexSongsSubCommand,
];
