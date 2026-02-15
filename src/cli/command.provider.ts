
import { ImportCommand } from './import.command';
import { BasicCommand } from './basic.command';
import { ClearCommand } from './clear.command';
import { SearchCommand } from './search.command';
import { MpdCommand } from './mpd/mpd.command';
import { TestMpdSubCommand } from './mpd/test.subcommand';
import { AddMpdSubCommand } from './mpd/add.subcommand';
import { PlayMpdSubCommand } from './mpd/play.subcommand';

export const CommandProviders = [
    ImportCommand,
    BasicCommand,
    ClearCommand,
    SearchCommand,
    MpdCommand,
    TestMpdSubCommand,
    AddMpdSubCommand,
    PlayMpdSubCommand
];
