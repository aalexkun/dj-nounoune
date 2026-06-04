import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QobuzService } from '../../services/qobuz/qobuz.service';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';

@SubCommand({
  name: 'import-favorite-albums',
  description: 'Import all favorite albums and their attached songs from Qobuz to MongoDB',
})
@Injectable()
export class QobuzImportFavoriteAlbumsSubCommand extends CommandRunner {
  private readonly logger = new Logger(QobuzImportFavoriteAlbumsSubCommand.name);

  constructor(
    private readonly qobuzService: QobuzService,
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {
    super();
  }

  async run(inputs: string[], options: Record<string, any>): Promise<void> {
    this.logger.log('Retrieving Qobuz favorite albums for import...');
    try {
      const limit = 50;
      let offset = 0;
      let total = 0;
      let importedAlbumsCount = 0;

      do {
        const response = await this.qobuzService.getFavoriteAlbums(limit, offset);
        
        if (!response || !response.albums) {
          throw new Error('Invalid response from Qobuz API: Missing albums property');
        }

        for (const albumItem of response.albums.items) {
          try {
            this.logger.debug(`Fetching details for album: ${albumItem.title} (${albumItem.id})`);
            const albumDetails = await this.qobuzService.getAlbum(albumItem.id);
            await this.importAlbum(albumDetails);
            importedAlbumsCount++;
          } catch (albumError) {
            const errMessage = albumError instanceof Error ? albumError.message : String(albumError);
            this.logger.error(`Failed to import album ${albumItem.id}: ${errMessage}`);
          }
        }

        total = response.albums.total;
        offset += limit;

      } while (offset < total);

      this.logger.log(`Successfully imported ${importedAlbumsCount} favorite albums with their tracks.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to retrieve/import favorite albums: ${errorMessage}`);
    }
  }

  private async importAlbum(albumDetails: any): Promise<void> {
    // 1. Find or create Artist
    const artistQobuzId = albumDetails.artist.id.toString();
    let artistDoc = await this.artistModel.findOne({
      'source.name': 'qobuz',
      'source.sourceId': artistQobuzId,
    });

    if (!artistDoc) {
      const genres = albumDetails.genre ? [albumDetails.genre.name] : [];
      artistDoc = new this.artistModel({
        artist: albumDetails.artist.name,
        primary_genres: genres,
        albums: [],
        source: [{ name: 'qobuz', sourceId: artistQobuzId }],
      });
      await artistDoc.save();
      this.logger.debug(`Created new artist: ${artistDoc.artist}`);
    }

    // 2. Find or create Album
    const albumQobuzId = albumDetails.id.toString();
    let albumDoc = await this.albumModel.findOne({
      'source.name': 'qobuz',
      'source.sourceId': albumQobuzId,
    });

    if (!albumDoc) {
      const releaseYear = albumDetails.release_date_original ? albumDetails.release_date_original.substring(0, 4) : undefined;
      const genre = albumDetails.genre ? [albumDetails.genre.name] : [];
      
      albumDoc = new this.albumModel({
        title: albumDetails.title,
        artist: artistDoc._id,
        release_year: releaseYear,
        track_count: albumDetails.tracks_count,
        genre: genre,
        image: albumDetails.image,
        release_date_original: albumDetails.release_date_original,
        subtitle: albumDetails.subtitle,
        description: albumDetails.description,
        tracks: [],
        source: [{ name: 'qobuz', sourceId: albumQobuzId }],
      });
      await albumDoc.save();
      this.logger.debug(`Created new album: ${albumDoc.title}`);
      
      // Update artist albums list
      if (!artistDoc.albums.includes(albumDoc._id as any)) {
        artistDoc.albums.push(albumDoc._id as any);
        await artistDoc.save();
      }
    }

    // 3. Process Tracks
    if (albumDetails.tracks && albumDetails.tracks.items) {
      for (const track of albumDetails.tracks.items) {
        const trackQobuzId = track.id.toString();
        let songDoc = await this.songModel.findOne({
          'source.name': 'qobuz',
          'source.sourceId': trackQobuzId,
        });

        if (!songDoc) {
          const trackYear = track.release_date_original ? track.release_date_original.substring(0, 4) : undefined;
          
          songDoc = new this.songModel({
            title: track.title,
            artist: artistDoc._id,
            album: albumDoc._id,
            album_artist: albumDetails.artist.name,
            track_number: track.track_number,
            disc_number: track.media_number,
            year: trackYear,
            category: albumDetails.genre?.name || 'Music',
            source: [{
              name: 'qobuz',
              sourceId: trackQobuzId,
              technical_info: {
                bitrate: 0,
                sample_rate: parseInt(`${track.maximum_sampling_rate}000`),
                bit_depth: parseInt(track.maximum_bit_depth),
                is_high_res: track.hires,
                is_cd_quality: true,
                extension: 'flac',
                duration: parseInt(track.duration),
              },
            }],
            path: `/qobuz/track/version/1/trackId/${trackQobuzId}`,
            filename: track.title,
            created_by: 'qobuz',
          });
          
          await songDoc.save();
          this.logger.debug(`Created new song: ${songDoc.title}`);
          
          if (!albumDoc.tracks.includes(songDoc._id as any)) {
            albumDoc.tracks.push(songDoc._id as any);
            await albumDoc.save();
          }
        }
      }
    }
  }
}
