import { Command, CommandRunner } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { OpensearchCreateIndexSubCommand } from './create-index.subcommand';
import { OpensearchIndexSongsSubCommand } from './index-songs.subcommand';
import { OpensearchPruneIndexSubCommand } from './prune-index.subcommand';
import { OpensearchSemanticSearchSubCommand } from './semantic-search.subcommand';

@Command({
  name: 'opensearch',
  arguments: '<task>',
  description: 'Manage OpenSearch indices and data with neural search',
  subCommands: [OpensearchCreateIndexSubCommand, OpensearchIndexSongsSubCommand, OpensearchPruneIndexSubCommand, OpensearchSemanticSearchSubCommand],
})
export class OpensearchCommand extends CommandRunner {
  private readonly logger = new Logger(OpensearchCommand.name);

  run(): Promise<void> {
    console.log('Use subcommands: create, prune, index, semantic');
    return Promise.resolve();
  }
}
