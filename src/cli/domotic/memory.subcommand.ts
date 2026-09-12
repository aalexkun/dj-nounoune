import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { LightingMemoryService } from '../../services/domotic/lighting-memory.service';
import { getErrorMessage } from '../../utils/error.utils';

interface MemoryOptions {
  clear?: boolean;
}

@SubCommand({
  name: 'memory',
  description: 'Show what the lighting designer has learnt about the household; --clear forgets it',
})
@Injectable()
export class DomoticMemorySubCommand extends CommandRunner {
  private readonly logger = new Logger(DomoticMemorySubCommand.name);

  constructor(private readonly memoryService: LightingMemoryService) {
    super();
  }

  async run(inputs: string[], options: MemoryOptions): Promise<void> {
    try {
      if (options.clear) {
        const cleared = await this.memoryService.clear();
        this.logger.log(cleared ? 'Lighting memory cleared.' : 'There was no lighting memory to clear.');
        return;
      }

      const memory = await this.memoryService.get();

      console.log(`=== summary (${memory.requests} request(s) folded in) ===`);
      console.log(memory.summary || '(nothing learnt yet)');
      console.log('');
      console.log('=== recent requests, oldest first ===');

      if (memory.recent.length === 0) {
        console.log('(none)');
      }

      for (const entry of memory.recent) {
        console.log(`${entry.at.toISOString()}  "${entry.request}"`);
        for (const action of entry.actions) {
          console.log(`    ${action}`);
        }
        if (entry.reply) console.log(`    -> ${entry.reply}`);
      }
    } catch (error) {
      this.logger.error(`Memory command failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({ flags: '--clear', description: 'Delete the household lighting memory', defaultValue: false })
  parseClear(): boolean {
    return true;
  }
}
