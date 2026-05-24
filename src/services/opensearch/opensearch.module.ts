import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpensearchService } from './opensearch.service';

@Module({
  imports: [ConfigModule],
  providers: [OpensearchService],
  exports: [OpensearchService],
})
export class OpensearchModule {}
