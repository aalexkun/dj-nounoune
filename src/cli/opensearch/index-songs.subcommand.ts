import { CommandRunner, SubCommand, Option } from 'nest-commander';
import { OpensearchService } from '../../services/opensearch/opensearch.service';
import { MusicDbService } from '../../services/music-db/music-db.service';
import { Logger } from '@nestjs/common';

interface IndexSongsCommandOptions {
  fetch?: number;
  addedAfter?: string;
}

@SubCommand({
  name: 'index',
  description: 'Fetch current songs from DB and index them in OpenSearch with Neural Search de-duplication',
})
export class OpensearchIndexSongsSubCommand extends CommandRunner {
  private readonly logger = new Logger(OpensearchIndexSongsSubCommand.name);

  constructor(
    private readonly opensearchService: OpensearchService,
    private readonly musicDbService: MusicDbService,
  ) {
    super();
  }

  async run(passedParam: string[], options?: IndexSongsCommandOptions): Promise<void> {
    const fetchLimit = options?.fetch;
    const addedAfter = options?.addedAfter ? new Date(options.addedAfter) : undefined;

    this.logger.log(
      `Fetching songs from MusicDb... limit: ${fetchLimit || 'All'}, added after: ${addedAfter ? addedAfter.toISOString() : 'Beginning of time'}`,
    );

    let songs = await this.musicDbService.getAllPopulatedSongs(addedAfter);

    // Sort by createdAt ascending safely
    songs = songs.sort((a, b) => {
      const docA = a as { createdAt?: Date | string };
      const docB = b as { createdAt?: Date | string };
      const dateA = docA.createdAt ? new Date(docA.createdAt).getTime() : 0;
      const dateB = docB.createdAt ? new Date(docB.createdAt).getTime() : 0;
      return dateA - dateB;
    });

    if (fetchLimit) {
      songs = songs.slice(0, fetchLimit);
    }

    if (songs.length === 0) {
      this.logger.log('No songs found to index.');
      return;
    }

    await this.opensearchService.indexSongs(songs);
  }

  @Option({
    flags: '-f, --fetch [fetch]',
    description: 'Limit the number of songs fetched',
  })
  parseFetch(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-a, --added-after [addedAfter]',
    description: 'Fetch songs added after this date (yyyy-mm-dd)',
  })
  parseAddedAfter(val: string): string {
    return val;
  }
}
