import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QobuzService } from './qobuz.service';

@Module({
  imports: [ConfigModule],
  providers: [QobuzService],
  exports: [QobuzService],
})
export class QobuzModule {}
