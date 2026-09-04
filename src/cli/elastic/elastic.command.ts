import { Command, CommandRunner } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { ElasticCreateIndexSubCommand } from './create-index.subcommand';
import { ElasticIndexSongsSubCommand } from './index-songs.subcommand';
import { ElasticPruneIndexSubCommand } from './prune-index.subcommand';

@Command({
  name: 'elastic',
  arguments: '<task>',
  description: 'Manage elasticsearch indices and data',
  subCommands: [ElasticCreateIndexSubCommand, ElasticIndexSongsSubCommand, ElasticPruneIndexSubCommand],
})
export class ElasticCommand extends CommandRunner {
  private readonly logger = new Logger(ElasticCommand.name);

  run(): Promise<void> {
    console.log('Use subcommands: create-index, prune-index, index-songs');
    return Promise.resolve();
  }
}
