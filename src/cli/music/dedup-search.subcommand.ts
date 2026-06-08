import { CommandRunner, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Deduplication, DeduplicationDocument } from '../../schemas/deduplication.schema';
import { OpensearchService, DuplicateSongCheck } from '../../services/opensearch/opensearch.service';
import { Artist } from '../../schemas/artist.schema';
import { Album } from '../../schemas/albums.schema';
import { OpenSearchHit } from '../../services/opensearch/types';

type PopulatedSongDocument = Omit<SongDocument, 'artist' | 'album'> & {
  artist: Artist;
  album: Album;
};

@SubCommand({
  name: 'search',
  description: 'Search for duplicate songs using OpenSearch and group them',
})
export class DedupSearchCommand extends CommandRunner {
  private readonly logger = new Logger(DedupSearchCommand.name);

  constructor(
    @InjectModel(Song.name) private readonly songModel: Model<SongDocument>,
    @InjectModel(Deduplication.name) private readonly deduplicationModel: Model<DeduplicationDocument>,
    private readonly opensearchService: OpensearchService,
  ) {
    super();
  }

  async run(): Promise<void> {
    this.logger.log('Starting deduplication search...');

    const cursor = this.songModel
      .find()
      .populate('artist')
      .populate('album')
      .cursor();

    let processed = 0;
    let skipped = 0;
    let grouped = 0;

    for await (const rawSong of cursor) {
      const song = rawSong as unknown as PopulatedSongDocument;
      const songId = song._id as Types.ObjectId;

      try {
        // Double-listing check: skip if this song is already in any dedup record
        const alreadyListed = await this.deduplicationModel.exists({
          'duplicates.songId': songId,
        });

        if (alreadyListed) {
          skipped++;
          continue;
        }

        // Build search attributes
        const artistName = typeof song.artist === 'object' && song.artist?.artist
          ? song.artist.artist
          : '';
        const albumTitle = typeof song.album === 'object' && song.album?.title
          ? song.album.title
          : '';

        const songAttributes: DuplicateSongCheck = {
          songId: songId.toString(),
          track_number: song.track_number ?? 0,
          disc_number: song.disc_number ?? 0,
          year: song.year ?? '',
          title: song.title ?? '',
          artist: artistName,
          album: albumTitle,
        };

        // Query OpenSearch
        const searchResponse = await this.opensearchService.findDuplicatesSongs(songAttributes);

        if (!searchResponse) {
          processed++;
          continue;
        }

        const hits = searchResponse.hits.hits;

        // Classify hits by confidence
        const highConfidenceHits = hits.filter((hit: OpenSearchHit) => hit._score >= 100);
        const lowConfidenceHits = hits.filter(
          (hit: OpenSearchHit) => hit._score >= 0.98 && hit._score < 100,
        );

        // Log high-confidence matches
        if (highConfidenceHits.length > 0) {
          this.logger.log(
            `\n━━━ HIGH CONFIDENCE DUPLICATES for "${songAttributes.artist} - ${songAttributes.album} - ${songAttributes.title}" (track ${songAttributes.track_number}) ━━━`,
          );

          for (const hit of highConfidenceHits) {
            this.logger.log(
              `  ├─ [score: ${hit._score.toFixed(2)}] Artist: "${hit._source.artist}" | Album: "${hit._source.album}" | Title: "${hit._source.title}" | Track: ${hit._source.track_number ?? 'N/A'}`,
            );
          }

          // Build the duplicates array: include the current song + all high-confidence hits
          const duplicates = [
            { songId: songId, score: 0 },
            ...highConfidenceHits.map((hit: OpenSearchHit) => ({
              songId: new Types.ObjectId(hit._id),
              score: hit._score,
            })),
          ];

          // Fetch full song documents for archiving
          const allSongIds = duplicates.map((d) => d.songId);
          const archivedDocs = await this.songModel.find({
            _id: { $in: allSongIds },
          }).lean().exec();

          // Create the deduplication record
          await this.deduplicationModel.create({
            duplicates,
            status: 'pending',
            archived: archivedDocs,
          });

          grouped++;
          this.logger.log(`  └─ Created dedup group with ${duplicates.length} songs.`);
        }

        if (lowConfidenceHits.length > 0) {
          this.logger.debug(
            `Low confidence hits for "${songAttributes.title}": ${lowConfidenceHits.length} match(es) (scores: ${lowConfidenceHits.map((h: OpenSearchHit) => h._score.toFixed(2)).join(', ')})`,
          );
        }

        processed++;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Error processing song ${songId}: ${err.message}`);
        processed++;
      }
    }

    this.logger.log(`\nDeduplication search complete.`);
    this.logger.log(`  Processed: ${processed}`);
    this.logger.log(`  Skipped (already listed): ${skipped}`);
    this.logger.log(`  Groups created: ${grouped}`);
  }
}
