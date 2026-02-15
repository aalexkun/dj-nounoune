import { ImportCommand } from './import.command';
import { BasicCommand } from './basic.command';
import { ClearCommand } from './clear.command';
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

export const CommandProviders = [
  ImportCommand,
  BasicCommand,
  ClearCommand,

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
];
