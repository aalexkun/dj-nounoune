import { CommandRunner, SubCommand } from 'nest-commander';
import { ElasticsearchService } from '../../services/elasticsearch/elasticsearch.service';

@SubCommand({ name: 'create-index', description: 'Create elasticsearch indices and settings' })
export class ElasticCreateIndexSubCommand extends CommandRunner {
  constructor(private readonly elasticsearchService: ElasticsearchService) {
    super();
  }

  async run(): Promise<void> {
    const success = await this.elasticsearchService.createIndex();
    if (!success) {
      process.exit(1);
    }
  }
}
