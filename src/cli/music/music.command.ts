import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { ImportCommand } from './import.command';
import { ClearCommand } from './clear.command';
import { EnrichCommand } from './enrich.command';
import { MigrateTechnicalInfoCommand } from './migrate-technical-info.command';
import { MigrateSongSourceCommand } from './migrate-song-source.command';
import { DedupCommand } from './dedup.command';
import { WhatsPlayingCommand } from './whats-playing.subcommand';
import { LyricSemanticCommand } from './lyric-semantic.subcommand';

@Command({
  name: 'music',
  description: 'Music Database management commands',
  subCommands: [
    ImportCommand,
    ClearCommand,
    EnrichCommand,
    MigrateTechnicalInfoCommand,
    MigrateSongSourceCommand,
    DedupCommand,
    WhatsPlayingCommand,
    LyricSemanticCommand,
  ],
})
@Injectable()
export class MusicCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: clear, import, enrich, lyric-semantic, migrate-technical-info, migrate-song-source, dedup, whats-playing');
    return Promise.resolve();
  }
}
