import { Command, CommandRunner } from 'nest-commander';
import { LogService } from 'src/services/logger.service';
import { PromptusService } from '../services/promptus/promptus/promptus.service';
import { SearchPromptusRequest } from '../services/promptus/promptus/request/SearchPromptusRequest';
import { MusicDbService } from '../services/music-db/music-db.service';

@Command({
  name: 'search',
  description: 'Search for artists, albums, and songs based on a human text query.',
})
export class SearchCommand extends CommandRunner {
  constructor(
    private readonly logService: LogService,
    private promptusService: PromptusService,
    private musicDbService: MusicDbService,
  ) {
    super();
  }

  async run(inputs: string[]): Promise<void> {
    const searchText = inputs.join(' ');

    const response = await this.promptusService.generate(new SearchPromptusRequest(searchText));

    if (response?.parsed?.function === 'aggregate') {
      console.log(response.parsed);
      const result = await this.musicDbService.aggregate(response.parsed.collection, response.parsed.params);
      console.log(result);
    } else {
      this.logService.dir(JSON.stringify(response));
      throw new Error('Unsupported response type');
    }

  }
}
