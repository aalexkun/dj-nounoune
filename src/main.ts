import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { join } from 'path';
import { getLogLevels } from './bootstrap.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: getLogLevels(),
  });

  // Front-end of the public /vibing-on page. Copied to dist by the `assets` entry in nest-cli.json;
  // the dedicated prefix keeps this middleware from shadowing the controller routes.
  app.useStaticAssets(join(__dirname, 'public', 'vibing'), { prefix: '/vibing-on/assets' });

  await app.listen(process.env.PORT ?? 3000);


  const version = process.env.npm_package_version || 'unknown';
  Logger.log(`Application version: ${version} is running!`, 'Bootstrap');
}
bootstrap();
