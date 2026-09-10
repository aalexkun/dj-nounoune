import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { QobuzService } from '../../services/qobuz/qobuz.service';

@SubCommand({
  name: 'import-favorite-albums',
  description: 'Import all favorite albums and their attached songs from Qobuz to MongoDB',
})
@Injectable()
export class QobuzImportFavoriteAlbumsSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzImportFavoriteAlbumsSubCommand.name);

  constructor(private readonly qobuzService: QobuzService) {
    super();
  }

  async run(): Promise<void> {
    await this.qobuzService.importFavoriteAlbums();
  }
}
