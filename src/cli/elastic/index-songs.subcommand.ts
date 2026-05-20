import { CommandRunner, SubCommand, Option } from 'nest-commander';
import { ElasticsearchService } from '../../services/elasticsearch/elasticsearch.service';
import { MusicDbService } from '../../services/music-db/music-db.service';
import { Logger } from '@nestjs/common';

interface IndexSongsCommandOptions {
  fetch?: number;
  addedAfter?: string;
}

@SubCommand({ name: 'index-songs', description: 'Fetch current songs and index them in Elasticsearch' })
export class ElasticIndexSongsSubCommand extends CommandRunner {
  private readonly logger = new Logger(ElasticIndexSongsSubCommand.name);

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly musicDbService: MusicDbService,
  ) {
    super();
  }

  async run(
    passedParam: string[],
    options?: IndexSongsCommandOptions,
  ): Promise<void> {
    const fetchLimit = options?.fetch;
    const addedAfter = options?.addedAfter ? new Date(options.addedAfter) : undefined;

    this.logger.log(`Fetching songs from MusicDb... limit: ${fetchLimit || 'All'}, added after: ${addedAfter || 'Beginning of time'}`);
    
    let songs = await this.musicDbService.getAllPopulatedSongs(addedAfter);

    // Sort by createdAt ascending (getAllPopulatedSongs doesn't sort explicitly but Mongoose often returns by natural order. We can enforce sort here just in case)
    songs = songs.sort((a, b) => {
       const dateA = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
       const dateB = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
       return dateA - dateB;
    });

    if (fetchLimit) {
      songs = songs.slice(0, fetchLimit);
    }

    if (songs.length === 0) {
      this.logger.log('No songs found to index.');
      return;
    }

    await this.elasticsearchService.indexSongs(songs);
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
