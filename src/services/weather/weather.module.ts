import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WeatherService } from './weather.service';

@Module({
  imports: [ConfigModule],
  providers: [WeatherService],
  exports: [WeatherService],
})
export class WeatherModule {}
