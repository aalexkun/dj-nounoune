import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { QobuzService } from '../../services/qobuz/qobuz.service';
import { QobuzAlbum } from '../../services/qobuz/qobuz.interfaces';

@SubCommand({
  name: 'favorite-albums',
  description: 'Retrieve and print all favorite albums and their attached songs from Qobuz',
})
@Injectable()
export class QobuzFavoriteAlbumsSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzFavoriteAlbumsSubCommand.name);

  constructor(private readonly qobuzService: QobuzService) {
    super();
  }

  async run(inputs: string[], options: Record<string, unknown>): Promise<void> {
    this.logger.log('Retrieving Qobuz favorite albums...');
    try {
      const limit = 50;
      let offset = 0;
      let total = 0;
      const allAlbums: QobuzAlbum[] = [];

      do {
        const response = await this.qobuzService.getFavoriteAlbums(limit, offset);
        
        if (!response || !response.albums) {
          throw new Error('Invalid response from Qobuz API: Missing albums property');
        }

        for (const albumItem of response.albums.items) {
          try {
            this.logger.debug(`Fetching details for album: ${albumItem.title} (${albumItem.id})`);
            const albumDetails = await this.qobuzService.getAlbum(albumItem.id);
            allAlbums.push(albumDetails);
          } catch (albumError) {
            const errMessage = albumError instanceof Error ? albumError.message : String(albumError);
            this.logger.error(`Failed to retrieve details for album ${albumItem.id}: ${errMessage}`);
          }
        }

        total = response.albums.total;
        offset += limit;

      } while (offset < total);

      console.log(JSON.stringify(allAlbums, null, 2));
      this.logger.log(`Successfully retrieved ${allAlbums.length} favorite albums with their tracks.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to retrieve favorite albums: ${errorMessage}`);
    }
  }
}
