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
import { PromptusClearCacheSubcommand } from './promptus/clear-cache.subcommand';
import { MusicCommand } from './music/music.command';
import { EnrichCommand } from './music/enrich.command';
import { MigrateTechnicalInfoCommand } from './music/migrate-technical-info.command';
import { MigrateSongSourceCommand } from './music/migrate-song-source.command';
import { PromptusChatSubcommand } from './promptus/chat.subcommand';
import { SpotifyCommand } from './spotify/spotify.command';
import { SpotifyAuthSubCommand } from './spotify/auth.subcommand';
import { SpotifyListUserLibrarySubCommand } from './spotify/list-user-library.subcommand';
import { SpotifyImportLikedSongsSubCommand } from './spotify/import-liked-songs.subcommand';
import { QobuzCommand } from './qobuz/qobuz.command';
import { QobuzFavoritesSubCommand } from './qobuz/favorites.subcommand';
import { QobuzFavoriteAlbumsSubCommand } from './qobuz/favorite-albums.subcommand';
import { QobuzAuthSubCommand } from './qobuz/auth.subcommand';
import { QobuzImportFavoriteAlbumsSubCommand } from './qobuz/import-favorite-albums.subcommand';
import { QobuzSearchTrackSubCommand } from './qobuz/search-track.subcommand';
import { QobuzSearchCurrentTrackSubCommand } from './qobuz/search-current-track.subcommand';
import { YoutubeCommand } from './youtube/youtube.command';
import { YoutubeAuthSubCommand } from './youtube/auth.subcommand';
import { YoutubeSearchTrackSubCommand } from './youtube/search-track.subcommand';
import { YoutubeSearchPlaylistSubCommand } from './youtube/search-playlist.subcommand';
import { YoutubeImportPlaylistSubCommand } from './youtube/import-playlist.subcommand';
import { YoutubePlaySubCommand } from './youtube/play.subcommand';
import { YoutubeLikedSubCommand } from './youtube/liked.subcommand';
import { YoutubePlaylistsSubCommand } from './youtube/playlists.subcommand';
import { ElasticCommand } from './elastic/elastic.command';
import { ElasticCreateIndexSubCommand } from './elastic/create-index.subcommand';
import { ElasticPruneIndexSubCommand } from './elastic/prune-index.subcommand';
import { ElasticIndexSongsSubCommand } from './elastic/index-songs.subcommand';
import { OpensearchCommand } from './opensearch/opensearch.command';
import { OpensearchCreateIndexSubCommand } from './opensearch/create-index.subcommand';
import { OpensearchPruneIndexSubCommand } from './opensearch/prune-index.subcommand';
import { OpensearchIndexSongsSubCommand } from './opensearch/index-songs.subcommand';
import { DedupCommand } from './music/dedup.command';
import { DedupSearchCommand } from './music/dedup-search.subcommand';
import { DedupProcessCommand } from './music/dedup-process.subcommand';
import { ProfilerCommand } from './profiler/profiler.command';
import { ProfilerRunSubCommand } from './profiler/run.subcommand';
import { WhatsPlayingCommand } from './music/whats-playing.subcommand';
import { NegentropyCommand } from './negentropy/negentropy.command';
import { NegentropyRunSubCommand } from './negentropy/run.subcommand';

export const CommandProviders = [
  MusicCommand,
  ImportCommand,
  ClearCommand,
  EnrichCommand,
  MigrateTechnicalInfoCommand,
  MigrateSongSourceCommand,
  DedupCommand,
  DedupSearchCommand,
  DedupProcessCommand,
  WhatsPlayingCommand,

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
  PromptusClearCacheSubcommand,

  SpotifyCommand,
  SpotifyAuthSubCommand,
  SpotifyListUserLibrarySubCommand,
  SpotifyImportLikedSongsSubCommand,

  QobuzCommand,
  QobuzFavoritesSubCommand,
  QobuzFavoriteAlbumsSubCommand,
  QobuzImportFavoriteAlbumsSubCommand,
  QobuzAuthSubCommand,
  QobuzSearchTrackSubCommand,
  QobuzSearchCurrentTrackSubCommand,

  YoutubeCommand,
  YoutubeAuthSubCommand,
  YoutubeSearchTrackSubCommand,
  YoutubeSearchPlaylistSubCommand,
  YoutubeImportPlaylistSubCommand,
  YoutubePlaySubCommand,
  YoutubeLikedSubCommand,
  YoutubePlaylistsSubCommand,

  ElasticCommand,
  ElasticCreateIndexSubCommand,
  ElasticPruneIndexSubCommand,
  ElasticIndexSongsSubCommand,

  OpensearchCommand,
  OpensearchCreateIndexSubCommand,
  OpensearchPruneIndexSubCommand,
  OpensearchIndexSongsSubCommand,

  ProfilerCommand,
  ProfilerRunSubCommand,

  NegentropyCommand,
  NegentropyRunSubCommand,
];

