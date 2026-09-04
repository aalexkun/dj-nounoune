import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { EnrichService } from '../../services/enrich/enrich.service';
import { getErrorMessage } from '../../utils/error.utils';

interface EnrichCommandOptions {
  ai?: boolean;
  clearCache?: boolean;
  Ffprobe?: boolean;
  bpm?: boolean;
  createdAt?: Date;
  limit?: number;
  batch?: number;
}

@SubCommand({
  name: 'enrich',
  description: 'Enrich the songs collection with technical metadata from ffprobe.',
})
@Injectable()
export class EnrichCommand extends CommandRunner {
  private readonly logger = new Logger(EnrichCommand.name);

  constructor(private readonly enrichService: EnrichService) {
    super();
  }

  async run(inputs: string[], options: EnrichCommandOptions): Promise<void> {
    try {
      if (options.clearCache) {
        await this.enrichService.clearCache();
        return;
      }

      await this.enrichService.run({
        ai: options.ai,
        ffprobe: options.Ffprobe,
        bpm: options.bpm,
        createdAt: options.createdAt,
        limit: options.limit,
        batch: options.batch,
      });
    } catch (error) {
      this.logger.error(`Enrich failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: ', --ai',
    description: 'Run enrich with ai prompt',
    defaultValue: false,
  })
  parseAi(): boolean {
    return true;
  }

  @Option({
    flags: ', --bpm',
    description: 'Run enrich to get songs bpm',
    defaultValue: false,
  })
  parseBpm(): boolean {
    return true;
  }

  @Option({
    flags: ', --Ffprobe',
    description: 'runs ffprobe',
    defaultValue: false,
  })
  parseFfprobe(): boolean {
    return true;
  }

  @Option({
    flags: ', --clear-cache',
    description: 'Clear current file and prompt cache. TTL 15m default',
    defaultValue: false,
  })
  parseClearCache(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit [limit]',
    description: 'Limit the number of items to process',
  })
  parseLimit(limit: string): number {
    return parseInt(limit, 10);
  }

  @Option({
    flags: '-b, --batch [batch]',
    description: 'Number of items to load before processing',
    defaultValue: 100,
  })
  parseBatch(batch: string): number {
    return parseInt(batch, 10);
  }

  @Option({
    flags: ', --createdAt [createdAt]',
    description: 'Filter songs created after a date (yyyy-mm-dd)',
  })
  parseCreatedAt(createdAt: string): Date {
    return new Date(createdAt);
  }
}
