import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Deduplication, DeduplicationDocument } from '../../schemas/deduplication.schema';
import { MergeService } from '../../services/merge/merge.service';

interface DedupProcessCommandOptions {
  dryRun?: boolean;
}

@SubCommand({
  name: 'process',
  description: 'Process pending deduplication records',
})
export class DedupProcessCommand extends CommandRunner {
  private readonly logger = new Logger(DedupProcessCommand.name);

  constructor(
    @InjectModel(Deduplication.name)
    private readonly deduplicationModel: Model<DeduplicationDocument>,
    private readonly mergeService: MergeService,
  ) {
    super();
  }

  async run(inputs: string[], options: DedupProcessCommandOptions): Promise<void> {
    const isDryRun = options.dryRun ?? true;

    if (isDryRun) {
      this.logger.warn('DRY RUN ACTIVE: No changes will be committed.');
    }

    const pendingRecords = await this.deduplicationModel.find({ status: 'pending' }).exec();

    this.logger.log(`Found ${pendingRecords.length} pending deduplication record(s).`);

    let processed = 0;
    let errors = 0;

    for (const record of pendingRecords) {
      const docId = String(record._id);
      const duplicates = record.duplicates;

      if (duplicates.length < 2) {
        this.logger.warn(`Dedup record ${docId} has fewer than 2 entries — skipping.`);
        continue;
      }

      // First entry (score 0) is the primary
      const primarySongId = duplicates[0].songId.toString();
      const duplicateEntries = duplicates.slice(1);

      this.logger.log(`Processing dedup ${docId}: primary=${primarySongId}, ${duplicateEntries.length} duplicate(s)`);

      try {
        for (const entry of duplicateEntries) {
          const duplicateSongId = entry.songId.toString();

          if (isDryRun) {
            this.logger.log(`  [DRY RUN] Would merge song ${duplicateSongId} (score: ${entry.score}) into ${primarySongId}`);
            continue;
          }

          this.logger.log(`  Merging song ${duplicateSongId} (score: ${entry.score}) into ${primarySongId}...`);

          await this.mergeService.mergeDuplicateTracks(primarySongId, duplicateSongId, docId);
        }

        if (isDryRun) {
          this.logger.log(`  [DRY RUN] Would set dedup ${docId} to status: 'completed'`);
        }

        processed++;
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to process dedup ${docId}: ${errMessage}`);

        if (!isDryRun) {
          await this.deduplicationModel.findByIdAndUpdate(docId, {
            $set: { status: 'error', errorMessage: errMessage },
          });
        }

        errors++;
      }
    }

    this.logger.log(`\nDedup processing complete.`);
    this.logger.log(`  Processed: ${processed}`);
    this.logger.log(`  Errors: ${errors}`);
    if (isDryRun) {
      this.logger.warn('DRY RUN: No changes were committed.');
    }
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Preview changes without committing to the database',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }
}
