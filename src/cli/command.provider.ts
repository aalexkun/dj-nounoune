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
import { PromptusChatSubcommand } from './promptus/chat.subcommand';

export const CommandProviders = [
  MusicCommand,
  ImportCommand,
  ClearCommand,
  EnrichCommand,

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
];
