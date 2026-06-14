import { CommandRunner, SubCommand } from 'nest-commander';
import { OpensearchService } from '../../services/opensearch/opensearch.service';

@SubCommand({
  name: 'create',
  description: 'Create OpenSearch indices, settings, ingest pipeline and deploy ML model',
})
export class OpensearchCreateIndexSubCommand extends CommandRunner {
  constructor(private readonly opensearchService: OpensearchService) {
    super();
  }

  async run(): Promise<void> {
    const success = await this.opensearchService.createIndex();
    if (!success) {
      process.exit(1);
    }
  }
}
