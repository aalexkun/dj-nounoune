import { Module } from '@nestjs/common';
import { QobuzImportScheduler } from './qobuz-import.scheduler';
import { QobuzModule } from '../services/qobuz/qobuz.module';

@Module({
  imports: [QobuzModule],
  providers: [QobuzImportScheduler],
})
export class SchedulersModule {}
