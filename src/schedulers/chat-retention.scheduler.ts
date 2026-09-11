import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ChatRetentionService } from '../services/chat/chat-retention.service';

/**
 * Hourly, on the hour.
 *
 * Hourly rather than nightly because the ceiling is a ceiling: a user who opens thirty
 * conversations in an afternoon should see the history sheet settle back to twenty that afternoon,
 * not the next morning. It is a bounded query per user against an indexed field, so the frequency
 * costs nothing.
 *
 * Never runs from the CLI — `ScheduleModule` is not imported there, the same gate the playlog
 * poller and the negentropy pass sit behind. Run one by hand with
 * `npm run cli -- chat prune --dry-run`.
 */
@Injectable()
export class ChatRetentionScheduler {
  private readonly logger = new Logger(ChatRetentionScheduler.name);

  constructor(private readonly retention: ChatRetentionService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    this.logger.debug(`Chat retention pass, keeping ${this.retention.limit} per user`);
    await this.retention.pruneQuietly();
  }
}
