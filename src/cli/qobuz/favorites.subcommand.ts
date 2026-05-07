import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { QobuzService } from '../../services/qobuz/qobuz.service';
import { QobuzTrack } from '../../services/qobuz/qobuz.interfaces';

@SubCommand({
  name: 'favorites',
  description: 'Retrieve and print all favorite songs from Qobuz',
})
@Injectable()
export class QobuzFavoritesSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzFavoritesSubCommand.name);

  constructor(private readonly qobuzService: QobuzService) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    this.logger.log('Retrieving Qobuz favorites...');
    try {
      const limit = 50;
      let offset = 0;
      let total = 0;
      const allFavorites: QobuzTrack[] = [];

      do {
        const response = await this.qobuzService.getFavorites(limit, offset);
        
        if (!response || !response.tracks) {
          throw new Error('Invalid response from Qobuz API');
        }

        allFavorites.push(...response.tracks.items);
        total = response.tracks.total;
        offset += limit;

      } while (offset < total);

      console.log(JSON.stringify(allFavorites, null, 2));
      this.logger.log(`Successfully retrieved ${allFavorites.length} favorite songs.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to retrieve favorites: ${errorMessage}`);
    }
  }
}
