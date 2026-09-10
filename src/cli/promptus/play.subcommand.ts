import { Injectable, Logger } from '@nestjs/common';
import { CommandRunner, SubCommand } from 'nest-commander';
import { PromptusService } from '../../services/promptus/promptus.service';

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
  run(passedParams: string[]): Promise<void> {
    this.logger.warn(`promptus play is not implemented yet (request: "${passedParams.join(' ')}")`);
    return Promise.resolve();
  }
}
