import { CommandRunner, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { PromptusService } from '../../services/promptus/promptus.service';

@SubCommand({
  name: 'clear-cache',
  description: 'Clear all GenAI caches',
})
export class PromptusClearCacheSubcommand extends CommandRunner {
  private readonly logger = new Logger(PromptusClearCacheSubcommand.name);

  constructor(private readonly promptusService: PromptusService) {
    super();
  }

  async run(): Promise<void> {
    this.logger.log('Fetching all GenAI caches...');
    
    try {
      const caches = await this.promptusService.cacheHandler.listCache();
      
      if (!caches || caches.length === 0) {
        this.logger.log('No caches found.');
        return;
      }
      
      this.logger.log(`Found ${caches.length} caches. Clearing...`);
      
      for (const cache of caches) {
        if (cache.displayName) {
          this.logger.log(`Clearing cache: ${cache.displayName}`);
          await this.promptusService.cacheHandler.clearCache(cache.displayName);
        } else {
          this.logger.warn(`Cache without displayName found: ${cache.name}`);
        }
      }
      
      this.logger.log('Finished clearing caches.');
    } catch (error) {
      this.logger.error('Failed to clear caches', error instanceof Error ? error.stack : String(error));
    }
  }
}
