import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';
import { getLogLevels } from './bootstrap.util';

async function bootstrap() {
  process.env.IS_CLI = 'true';
  await CommandFactory.run(AppModule, {
    logger: getLogLevels(),
  });
}
void bootstrap();
