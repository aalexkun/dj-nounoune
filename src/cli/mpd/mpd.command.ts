import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { TestMpdSubCommand } from './test.subcommand';
import { AddMpdSubCommand } from './add.subcommand';
import { PlayMpdSubCommand } from './play.subcommand';
import { ClearMpdSubCommand } from './clear.subcommand';
import { ShuffleMpdSubCommand } from './shuffle.subcommand';
import { PlaylistMpdSubCommand } from './playlist.subcommand';

@Command({
  name: 'mpd',
  description: 'MPD Client commands',
  subCommands: [TestMpdSubCommand, AddMpdSubCommand, PlayMpdSubCommand, ClearMpdSubCommand, ShuffleMpdSubCommand, PlaylistMpdSubCommand],
})
@Injectable()
export class MpdCommand extends CommandRunner {
  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    // Root command execution if needed, usually empty for subcommands container
    console.log('Use subcommands: test, add, play');
  }
}
