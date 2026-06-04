import { CommandRunner, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Song, SongDocument } from '../../schemas/song.schema';

@SubCommand({
  name: 'migrate-technical-info',
  description:
    'Migrate technical_info from the song root into source[0]. Assumes each song has exactly one source entry.',
})
@Injectable()
export class MigrateTechnicalInfoCommand extends CommandRunner {
  private readonly logger = new Logger(MigrateTechnicalInfoCommand.name);

  constructor(
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {
    super();
  }

  async run(): Promise<void> {
    this.logger.log('Starting migration: moving technical_info into source[0]...');

    // Find all songs that still have the legacy top-level technical_info field
    const cursor = this.songModel
      .find({ technical_info: { $exists: true } })
      .cursor();

    let migrated = 0;
    let skipped = 0;
    let errored = 0;

    for await (const song of cursor) {
      try {
        // Access the raw document to read the legacy field that no longer exists in the schema
        const rawDoc = song.toObject();
        const legacyTechnicalInfo = (rawDoc as unknown as Record<string, unknown>)['technical_info'];

        if (!legacyTechnicalInfo) {
          skipped++;
          continue;
        }

        if (!song.source || song.source.length === 0) {
          this.logger.warn(
            `Song "${song.title}" (${song._id}) has no source entries – skipping`,
          );
          skipped++;
          continue;
        }

        // Atomically move technical_info into source[0] and unset the legacy field
        await this.songModel.updateOne(
          { _id: song._id },
          {
            $set: { 'source.0.technical_info': legacyTechnicalInfo },
            $unset: { technical_info: '' },
          },
        );

        migrated++;

        if (migrated % 100 === 0) {
          this.logger.log(`Progress: ${migrated} songs migrated...`);
        }
      } catch (err) {
        errored++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to migrate song "${song.title}" (${song._id}): ${errorMessage}`,
        );
      }
    }

    this.logger.log(
      `Migration complete. Migrated: ${migrated}, Skipped: ${skipped}, Errors: ${errored}`,
    );
  }
}
