import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';

import { MongoToolsDefinition } from '../../definition/mongo-tools.definition';
import { MusicDbService } from '../../../../music-db/music-db.service';
import { generatePsv } from '../../../../../utils/psv.utils';

export class BPMDistributionHandler implements ToolHandler {
  readonly name = MongoToolsDefinition.bpmDistribution.name;
  private readonly logger = new Logger('BPMDistributionHandler');

  constructor(private readonly musicDbService: MusicDbService) {}

  async execute(): Promise<FunctionCallResult> {
    try {
      const result = await this.musicDbService.getBPMDistribution();
      return {
        message: generatePsv(result),
        name: this.name,
        type: 'string',
      };
    } catch (e: any) {
      const msg = 'Function call failed with error: ' + e.message;
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
        type: 'string',
      };
    }
  }
}
