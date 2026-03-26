import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { MusicDbService } from '../../../../../music-db/music-db.service';
import { generatePsv } from '../../../../../../utils/psv.utils';

export class ArtistDistributionHandler implements ToolHandler {
  readonly name = 'artist_distribution';
  private readonly logger = new Logger('ArtistDistributionHandler');

  constructor(private readonly musicDbService: MusicDbService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      const result = await this.musicDbService.getArtistDistribution();
      return {
        message: generatePsv(result),
        name: this.name,
      };
    } catch (e: any) {
      const msg = 'Function call failed with error: ' + e.message;
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
      };
    }
  }
}
