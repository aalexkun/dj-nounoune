import { CommandRunner, SubCommand } from 'nest-commander';
import { ElasticsearchService } from '../../services/elasticsearch/elasticsearch.service';

@SubCommand({ name: 'prune-index', description: 'Delete all elasticsearch indices to restart the process' })
export class ElasticPruneIndexSubCommand extends CommandRunner {
  constructor(private readonly elasticsearchService: ElasticsearchService) {
    super();
  }

  async run(): Promise<void> {
    await this.elasticsearchService.pruneIndex();
  }
}
