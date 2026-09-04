import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { EnrichService } from '../../services/enrich/enrich.service';
import { getErrorMessage } from '../../utils/error.utils';

interface LyricSemanticCommandOptions {
  limit?: number;
  batch?: number;
  concurrency?: number;
}

/**
 * Capped on purpose. One uncached request per song against GEMINI_FLASH is not the metadata
 * pass's cost profile, and nothing should run it over the whole library until that cost has
 * been measured. Raise --limit by hand, batch by batch.
 */
const DEFAULT_LIMIT = 50;

@SubCommand({
  name: 'lyric-semantic',
  description: `Distil each queued song's lyrics into one sentence for semantic search. Capped at ${DEFAULT_LIMIT} songs unless --limit says otherwise.`,
})
@Injectable()
export class LyricSemanticCommand extends CommandRunner {
  private readonly logger = new Logger(LyricSemanticCommand.name);

  constructor(private readonly enrichService: EnrichService) {
    super();
  }

  async run(inputs: string[], options: LyricSemanticCommandOptions): Promise<void> {
    try {
      await this.enrichService.run({
        lyricSemantic: true,
        limit: options.limit ?? DEFAULT_LIMIT,
        batch: options.batch,
        concurrency: options.concurrency,
      });
    } catch (error) {
      this.logger.error(`Lyric semantic enrichment failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-l, --limit [limit]',
    description: `Queued songs to process this run (default ${DEFAULT_LIMIT})`,
  })
  parseLimit(limit: string): number {
    return parseInt(limit, 10);
  }

  @Option({
    flags: '-b, --batch [batch]',
    description: 'Songs fetched from the queue per round (default 20)',
  })
  parseBatch(batch: string): number {
    return parseInt(batch, 10);
  }

  @Option({
    flags: '-c, --concurrency [concurrency]',
    description: 'Requests in flight at once (default 5)',
  })
  parseConcurrency(concurrency: string): number {
    return parseInt(concurrency, 10);
  }
}
