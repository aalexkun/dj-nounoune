import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { MusicDbService } from '../../../../../music-db/music-db.service';
import { generatePsv } from '../../../../../../utils/psv.utils';

export class BPMDistributionHandler implements ToolHandler {
  readonly name = 'bpm_distribution';
  private readonly logger = new Logger('BPMDistributionHandler');

  constructor(private readonly musicDbService: MusicDbService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      const result = await this.musicDbService.getBPMDistribution();
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
