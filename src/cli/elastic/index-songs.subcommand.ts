import { CommandRunner, SubCommand, Option } from 'nest-commander';
import { ElasticsearchService } from '../../services/elasticsearch/elasticsearch.service';
import { MusicDbService, PopulatedSong } from '../../services/music-db/music-db.service';
import { Logger } from '@nestjs/common';

interface IndexSongsCommandOptions {
  fetch?: number;
  addedAfter?: string;
}

/** `createdAt` comes from the schema's `timestamps` option, so it is not on the document type. */
function createdAtMillis(song: PopulatedSong): number {
  const value = (song as { createdAt?: unknown }).createdAt;
  if (value instanceof Date) return value.getTime();
  return typeof value === 'string' ? new Date(value).getTime() : 0;
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

  async run(_passedParam: string[], options?: IndexSongsCommandOptions): Promise<void> {
    const fetchLimit = options?.fetch;
    const addedAfter = options?.addedAfter ? new Date(options.addedAfter) : undefined;

    this.logger.log(
      `Fetching songs from MusicDb... limit: ${fetchLimit || 'All'}, added after: ${addedAfter ? addedAfter.toISOString() : 'Beginning of time'}`,
    );

    let songs = await this.musicDbService.getAllPopulatedSongs(addedAfter);

    // Sort by createdAt ascending (getAllPopulatedSongs doesn't sort explicitly but Mongoose often returns by natural order. We can enforce sort here just in case)
    songs = songs.sort((a, b) => createdAtMillis(a) - createdAtMillis(b));

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
