import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnrichService } from '../services/enrich/enrich.service';
import { getErrorMessage } from '../utils/error.utils';

/** How many queued songs the nightly AI pass is allowed to work through. */
const NIGHTLY_AI_LIMIT = 2000;

@Injectable()
export class EnrichScheduler {
  private readonly logger = new Logger(EnrichScheduler.name);

  constructor(private readonly enrichService: EnrichService) {}

  /** Process 2000 new songs a day, at 02:00. */
  @Cron('0 2 * * *')
  async handleCron() {
    this.logger.log('Starting scheduled AI enrichment...');

    try {
      await this.enrichService.run({
        ai: true,
        ffprobe: false,
        bpm: false,
        limit: NIGHTLY_AI_LIMIT,
      });

      this.logger.log('Scheduled AI enrichment completed successfully.');
    } catch (error) {
      this.logger.error(`Scheduled AI enrichment failed: ${getErrorMessage(error)}`);
    }
  }
}
