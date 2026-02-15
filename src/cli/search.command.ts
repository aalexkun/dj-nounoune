import { Command, CommandRunner } from 'nest-commander';
import { PromptusService } from '../services/promptus/promptus/promptus.service';
import { SearchPromptusRequest } from '../services/promptus/promptus/request/SearchPromptusRequest';
import { MusicDbService } from '../services/music-db/music-db.service';
import { Logger } from '@nestjs/common';

@Command({
  name: 'search',
  description: 'Search for artists, albums, and songs based on a human text query.',
})
export class SearchCommand extends CommandRunner {
  private readonly logger = new Logger(SearchCommand.name);

  constructor(
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
      this.logger.error(JSON.stringify(response, null, 2));
      throw new Error('Unsupported response type');
    }
  }
}
