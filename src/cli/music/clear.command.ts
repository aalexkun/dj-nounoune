import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Logger } from '@nestjs/common';

interface ClearCommandOptions {
  dryRun?: boolean;
  collections?: string[];
}

@SubCommand({
  name: 'clear',
  description: 'Clear songs, albums, and artists collections',
})
export class ClearCommand extends CommandRunner {
  private readonly logger = new Logger(ClearCommand.name);

  constructor(
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {
    super();
  }

  async run(inputs: string[], options: ClearCommandOptions): Promise<void> {
    const { dryRun, collections } = options;
    const targetCollections = collections && collections.length > 0 ? collections : ['songs', 'albums', 'artists'];

    this.logger.log(`Starting clear process...`);
    if (dryRun) {
      this.logger.warn('DRY RUN ACTIVE: No changes will be committed to the database.');
    }

    if (targetCollections.includes('songs')) {
      await this.clearCollection(this.songModel, 'Songs', dryRun);
    }

    if (targetCollections.includes('albums')) {
      await this.clearCollection(this.albumModel, 'Albums', dryRun);
    }

    if (targetCollections.includes('artists')) {
      await this.clearCollection(this.artistModel, 'Artists', dryRun);
    }

    this.logger.log('Clear process completed.');
  }

  private async clearCollection(model: Model<any>, name: string, dryRun?: boolean) {
    const count = await model.countDocuments();
    if (dryRun) {
      this.logger.log(`[DryRun] Would delete ${count} documents from ${name}`);
    } else {
      await model.deleteMany({});
      this.logger.log(`Deleted ${count} documents from ${name}`);
    }
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Run the clear command without deleting data',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-c, --collections <collections...>',
    description: 'List of collections to clear (songs, albums, artists)',
  })
  parseCollections(option: string, collections: string[] = []): string[] {
    // nest-commander handles variadic options by calling the parser for each value
    // assuming it comes as a list if separated by space, but let's handle single string accumulation
    collections.push(option);
    return collections;
  }
}
