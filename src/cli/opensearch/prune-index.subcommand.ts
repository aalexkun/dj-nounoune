import { CommandRunner, SubCommand } from 'nest-commander';
import { OpensearchService } from '../../services/opensearch/opensearch.service';

@SubCommand({
  name: 'prune-index',
  description: 'Delete OpenSearch songs index, ingest pipeline and undeploy model',
})
export class OpensearchPruneIndexSubCommand extends CommandRunner {
  constructor(private readonly opensearchService: OpensearchService) {
    super();
  }

  async run(): Promise<void> {
    await this.opensearchService.pruneIndex();
  }
}
