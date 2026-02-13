import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';
import { LogService } from './services/logger.service';

async function bootstrap() {
  await CommandFactory.run(AppModule, new LogService());
  await CommandFactory.run(AppModule, ['warn', 'error']);
}
bootstrap();
