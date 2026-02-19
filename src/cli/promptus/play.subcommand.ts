import { Injectable, Logger } from '@nestjs/common';
import { CommandRunner, SubCommand } from 'nest-commander';
import { PromptusService } from '../../services/promptus/promptus/promptus.service';
import { MusicDbService } from '../../services/music-db/music-db.service';
import { SearchPromptusRequest } from '../../services/promptus/promptus/request/search.promptus.request';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { ClearMpdRequest } from '../../services/mpd-client/requests/ClearMpdRequest';
import { AddMpdRequest } from '../../services/mpd-client/requests/AddMpdRequest';
import { Song } from '../../schemas/song.schema';
import { PlayMpdRequest } from '../../services/mpd-client/requests/PlayMpdRequest';
import { GetSourceIdPromptusRequest } from '../../services/promptus/promptus/request/get-source-id.promptus.request';

@SubCommand({
  name: 'play',
  description: 'Start playback for a give request',
})
@Injectable()
export class PromptusPlaySubcommand extends CommandRunner {
  private readonly logger = new Logger(PromptusPlaySubcommand.name);

  constructor(
    private promptusService: PromptusService,
    private mpdClientService: MpdClientService,
    private musicDbService: MusicDbService,
  ) {
    super();
  }
  async run(passedParams: string[], options?: Record<string, any>): Promise<void> {
    const searchText = passedParams.join(' ');

    const response = await this.promptusService.generate(new SearchPromptusRequest(searchText));

    if (!Array.isArray(response) && response?.parsed?.function === 'aggregate') {
      this.logger.debug(JSON.stringify(response.parsed, null, 2));
      const result = await this.musicDbService.aggregate(response.parsed.collection, response.parsed.params);

      if (result.length > 0) {
        const sourceIdsResponse = await this.promptusService.generate(new GetSourceIdPromptusRequest(JSON.stringify(result)));

        if (!Array.isArray(sourceIdsResponse) && sourceIdsResponse.sources.length > 0) {
          this.logger.log('Clearing the Queue');
          await this.mpdClientService.send(new ClearMpdRequest());

          await Promise.all(
            sourceIdsResponse.sources.map(async (source) => {
              const result = await this.mpdClientService.send(new AddMpdRequest(source.sourceId));
              this.logger.debug(`Response: ${result.rawResponse.trim()}`);
            }),
          );

          this.logger.log('Playlist is Generated');

          const playResult = await this.mpdClientService.send(new PlayMpdRequest());
          this.logger.log('Playback started.');
          this.logger.debug(playResult.rawResponse);
        } else {
          this.logger.warn('No files found for query: ' + searchText);
        }
      } else {
        this.logger.warn('No results found for query: ' + searchText);
        this.logger.debug(JSON.stringify(response?.parsed, null, 2));
      }
    } else {
      this.logger.error(JSON.stringify(response, null, 2));
      throw new Error('Unsupported response type');
    }
  }
}
