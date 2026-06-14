import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QobuzService } from '../services/qobuz/qobuz.service';

@Injectable()
export class QobuzImportScheduler {
  private readonly logger = new Logger(QobuzImportScheduler.name);

  constructor(private readonly qobuzService: QobuzService) {}

  @Cron('0 6 * * *')
  async handleCron() {
    this.logger.log('Starting scheduled Qobuz favorite albums import...');
    try {
      await this.qobuzService.importFavoriteAlbums();
      this.logger.log('Scheduled Qobuz import completed successfully.');
    } catch (error) {
      this.logger.error('Scheduled Qobuz import failed', error);
    }
  }
}
