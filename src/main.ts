import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { getLogLevels } from './bootstrap.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: getLogLevels(),
  });
  await app.listen(process.env.PORT ?? 3000);


  const version = process.env.npm_package_version || 'unknown';
  Logger.log(`Application version: ${version} is running!`, 'Bootstrap');
}
bootstrap();
