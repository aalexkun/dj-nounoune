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

  constructor(private promptusService: PromptusService) {
    super();
  }
  async run(passedParams: string[], options?: Record<string, any>): Promise<void> {
    const searchText = passedParams.join(' ');

    await this.promptusService.play(searchText);
  }
}
