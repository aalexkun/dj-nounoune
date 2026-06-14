import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';
import { getLogLevels } from './bootstrap.util';

async function bootstrap() {
  await CommandFactory.run(AppModule, {
    logger: getLogLevels(),
  });
}
bootstrap();
