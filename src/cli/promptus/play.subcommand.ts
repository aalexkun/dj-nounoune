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
  async run(passedParams: string[], options?: Record<string, any>): Promise<void> {
    const searchText = passedParams.join(' ');

    //
  }
}
