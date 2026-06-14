import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Song, SongDocument } from '../../schemas/song.schema';

interface MigrateSongSourceOptions {
  dryRun?: boolean;
}

@SubCommand({
  name: 'migrate-song-source',
  description:
    'Migrate root-level path and filename into source[0]. Assumes each song has at most one legacy path/filename pair.',
})
@Injectable()
export class MigrateSongSourceCommand extends CommandRunner {
  private readonly logger = new Logger(MigrateSongSourceCommand.name);

  constructor(
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {
    super();
  }

  async run(_inputs: string[], options: MigrateSongSourceOptions): Promise<void> {
    const dryRun = options.dryRun ?? false;

    this.logger.log('Starting migration: moving root path/filename into source[0]...');
    if (dryRun) {
      this.logger.warn('DRY RUN ACTIVE: No changes will be committed to the database.');
    }

    // Only select documents that still have the legacy root-level fields
    const cursor = this.songModel
      .find({
        $or: [
          { path: { $exists: true } },
          { filename: { $exists: true } },
        ],
      })
      .cursor();

    let migrated = 0;
    let skipped = 0;
    let errored = 0;

    for await (const song of cursor) {
      try {
        // Access the raw document to read legacy fields that no longer exist in the schema
        const rawDoc = song.toObject() as unknown as Record<string, unknown>;
        const legacyPath = rawDoc['path'] as string | undefined;
        const legacyFilename = rawDoc['filename'] as string | undefined;

        // Skip if neither field is present (already migrated or never had them)
        if (!legacyPath && !legacyFilename) {
          skipped++;
          continue;
        }

        // Skip if no source entries exist to receive the data
        if (!song.source || song.source.length === 0) {
          this.logger.warn(
            `Song "${song.title}" (${song._id}) has no source entries – skipping`,
          );
          skipped++;
          continue;
        }

        if (dryRun) {
          this.logger.log(
            `[DryRun] Would migrate song "${song.title}" (${song._id}): ` +
            `path="${legacyPath ?? ''}", filename="${legacyFilename ?? ''}" → source[0]`,
          );
          migrated++;
          continue;
        }

        // Build the $set payload – only set fields that actually exist
        const $set: Record<string, unknown> = {};
        if (legacyPath !== undefined) {
          $set['source.0.path'] = legacyPath;
        }
        if (legacyFilename !== undefined) {
          $set['source.0.filename'] = legacyFilename;
        }

        // Atomically move fields into source[0] and unset the legacy root fields
        await this.songModel.updateOne(
          { _id: song._id },
          {
            $set,
            $unset: { path: '', filename: '' },
          },
          { strict: false },
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

    const verb = dryRun ? 'Would migrate' : 'Migrated';
    this.logger.log(
      `Migration complete. ${verb}: ${migrated}, Skipped: ${skipped}, Errors: ${errored}`,
    );
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Output proposed changes without modifying the database',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }
}
