import { Command, CommandRunner, Option } from 'nest-commander';
import { LogService } from 'src/services/logger.service';
import { ParsedPsvRow, PsvService } from '../services/transformation/psv.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Artist, ArtistDocument } from '../schemas/artist.schema';
import { Album, AlbumDocument } from '../schemas/albums.schema';
import { Song, SongDocument } from '../schemas/song.schema';
import { createHash } from 'crypto';
import { PathTransformer } from '../utils/path.transformer';
import { AppService } from '../app.service';

interface ImportCommandOptions {
  file: string;
  dryRun?: boolean;
}

@Command({
  name: 'import',
  description: 'Import songs from a PSV file',
})
export class ImportCommand extends CommandRunner {
  private pathTransformer: PathTransformer;
  constructor(
    private readonly logService: LogService,
    private readonly psvParser: PsvService,
    private appService: AppService,
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {
    super();

    this.pathTransformer = new PathTransformer(this.appService.getImportPathStyle(), this.appService.getImportLibraryRootPath());
  }

  generateId(content: string): Types.ObjectId {
    const hash = createHash('md5').update(content).digest('hex');
    // Use the first 24 hex characters (12 bytes) to create a valid ObjectId
    return new Types.ObjectId(hash.substring(0, 24));
  }

  async run(inputs: string[], options: ImportCommandOptions): Promise<void> {
    const { file, dryRun } = options;

    this.logService.log(`Starting import process for: ${file}`);
    if (dryRun) {
      this.logService.warn('DRY RUN ACTIVE: No changes will be committed to the database.');
    }

    let count = 0;

    // Call the parser and pass a callback function for saving
    await this.psvParser.parseFile(options.file, async (userDoc: ParsedPsvRow) => {
      const artistName = userDoc.artist || 'Unknown Artist';
      const userGenre = userDoc.genre ? [userDoc.genre] : [];
      const artistId = this.generateId(artistName);

      const albumTitle = userDoc.album || 'Unknown Album';
      const albumArtistName = userDoc.album_artist || artistName;
      // Album ID depends on Album Title and Album Artist (or Artist)
      const albumId = this.generateId(`${albumTitle}|${albumArtistName}`);

      // Song ID depends on all content (using JSON stringify of the parsed object for simplicity and coverage)
      // The requirement says "md5 of all know information from that parse PSV"
      const songAvailableInfo = JSON.stringify(userDoc);
      const songId = this.generateId(songAvailableInfo);

      if (!dryRun) {
        // 1. Upsert Artist
        await this.artistModel.updateOne(
          { _id: artistId },
          {
            $set: {
              artist: artistName,
            },
            $addToSet: {
              primary_genres: { $each: userGenre },
              albums: albumId,
            },
          },
          { upsert: true },
        );

        // 2. Upsert Album
        await this.albumModel.updateOne(
          { _id: albumId },
          {
            $set: {
              title: albumTitle,
              artist: artistId, // Linking to the main artist (or should it be album artist? Schema says 'artist')
              // Assuming 'artist' field in Album refers to the primary artist.
              // If album_artist is different, we might need to handle it, but for now we link to the generated artistId.
              // Ideally we should generate an ID for album_artist too if it's different, but let's stick to the simple flow first.
              release_year: userDoc.year,
              // genre: userGenre, // Album might have multiple genres from songs... keeping it simple for now
            },
            $addToSet: {
              tracks: songId,
              genre: { $each: userGenre },
            },
          },
          { upsert: true },
        );

        // 3. Upsert Song
        await this.songModel.updateOne(
          { _id: songId },
          {
            $set: {
              artist: artistId,
              album: albumId,
              album_artist: albumArtistName,
              title: userDoc.title,
              composer: userDoc.composer,
              genre: userDoc.genre,
              year: userDoc.year,
              track_number: userDoc.track_number,
              disc_number: userDoc.disc_number,
              bpm: userDoc.bpm,
              category: userDoc.category,
              filename: userDoc.filename,
              path: userDoc.path,
              source: [
                {
                  name: 'file',
                  sourceId: `${this.pathTransformer.transform(userDoc.path)}${userDoc.filename}`,
                },
              ],
              technical_info: userDoc.technical_info,
            },
          },
          { upsert: true },
        );
      } else {
        // In dry-run, maybe just log a sampling or just the ID generation
        // this.logService.log(`[DryRun] Would upsert Artist: ${artistName} (${artistId})`);
        // this.logService.log(`[DryRun] Would upsert Album: ${albumTitle} (${albumId})`);
        // this.logService.log(`[DryRun] Would upsert Song: ${userDoc.title} (${songId})`);
      }

      count++;
      if (count % 100 === 0) console.log(`Processed ${count} records...`);
    });

    console.log(`Done! Total imported: ${count}`);
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Run the import without saving changes to the database',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-f, --file <file>',
    description: 'File to import',
    required: true,
  })
  parseFile(val: string): string {
    return val;
  }
}
