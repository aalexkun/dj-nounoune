import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Enrich, EnrichDocument } from '../../schemas/enrich.schema';
import { Model, PipelineStage, QueryFilter, Types } from 'mongoose';
import { SongSource, SourceType } from '../../schemas/source.schema';
import { buildActiveSourceMatch, getActiveSourceTypes, isSourceActive } from '../../config/active-source.util';
import { z } from 'zod';
import { FilterCollection, FilterCondition, MongoQueryDefinition } from './mongo-filter.type';
import { buildMatch, MongoMatch, SchemaPathResolver } from './mongo-filter.util';
import { Playlog, PlaylogDocument } from '../../schemas/playlog.schema';

export type MusicDbAggregateResult = ArtistDocument | AlbumDocument | SongDocument;

/** The enrichers a song passes through. Each one is a key of `EnrichStatus`. */
export const ENRICH_TYPES = ['ai', 'bpm', 'ffprobe', 'lyric_semantic'] as const;
export type EnrichType = (typeof ENRICH_TYPES)[number];
export type EnrichState = 'queued' | 'completed' | 'notApplicable';

/** One resolved LLM query: the intent it was generated for, and the songs it yielded. */
export type MongoWrapperResult = {
  intent: string;
  items: PopulatedSong[];
};

export type PopulatedSong = Omit<SongDocument, 'artist' | 'album'> & {
  artist: ArtistDocument;
  album: AlbumDocument;
};

export const PopulatedSongSchema = z.custom<PopulatedSong>((val: any) => {
  return typeof val === 'object' && val !== null && 'artist' in val && typeof val.artist === 'object' && 'album' in val && typeof val.album === 'object';
});

/** Album artwork urls, in the shape the album document stores them. */
export type AlbumImage = {
  small?: string;
  thumbnail?: string;
  large?: string;
  back?: string;
};

/** The latest playlog row, resolved to the song it points at. */
export type LastPlayedSong = {
  playedAt: Date;
  song: PopulatedSong;
};

/** One row of the recently-played aggregation: artist name and the minute-precision timestamp it was last played at. */
export const RecentlyPlayedArtistSchema = z.object({
  artist: z.string(),
  playedAt: z.string(),
});

export type RecentlyPlayedArtist = z.infer<typeof RecentlyPlayedArtistSchema>;

/**
 * Listener reactions for one song, summed over every play in the playlog. `plays` counts the rows,
 * reacted to or not, so a caller can tell one enthusiastic play from a steady favourite.
 */
export const SongReactionsSchema = z.object({
  songId: z.string(),
  plays: z.number().int().nonnegative(),
  awesome: z.number().int().nonnegative(),
  great: z.number().int().nonnegative(),
  duh: z.number().int().nonnegative(),
  wtf: z.number().int().nonnegative(),
});

export type SongReactions = z.infer<typeof SongReactionsSchema>;

@Injectable()
export class MusicDbService {
  private readonly logger = new Logger(MusicDbService.name);
  constructor(
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
    @InjectModel(Enrich.name) private enrichModel: Model<EnrichDocument>,
    @InjectModel(Playlog.name) private playlogModel: Model<PlaylogDocument>,
  ) {}

  async syncEnrich(): Promise<void> {
    await this.songModel
      .aggregate([
        {
          $project: {
            _id: 1,
            status: {
              ai: 'queued',
              bpm: 'queued',
              ffprobe: 'queued',
              lyric_semantic: 'queued',
            },
            createdAt: '$$NOW',
            updatedAt: '$$NOW',
          },
        },
        {
          $merge: {
            into: this.enrichModel.collection.name,
            on: '_id',
            whenMatched: 'keepExisting',
            whenNotMatched: 'insert',
          },
        },
      ])
      .exec();

    // `keepExisting` above leaves every document that already exists untouched, so an enricher
    // added after a song was first queued never gets a status key on it — and a cursor on
    // `status.<type>: 'queued'` then matches nothing. Backfill here rather than in a one-off
    // migration: it runs on every pass, is idempotent, and covers the next enricher too.
    for (const type of ENRICH_TYPES) {
      await this.enrichModel.updateMany(
        { [`status.${type}`]: { $exists: false } },
        { $set: { [`status.${type}`]: 'queued' } },
      );
    }
  }

  async updateEnrichStatus(
    songId: string,
    type: EnrichType,
    status: EnrichState,
    message?: string,
    response?: Record<string, unknown>,
  ): Promise<void> {
    const update: Record<string, unknown> = { [`status.${type}`]: status };
    if (message !== undefined) update.message = message;

    // Merge, never replace. `response` is shared by every enricher — the AI pass leaves
    // `{ genre, language, ... }` there, the lyric pass adds `{ semantic }` — and a whole-field
    // `$set` would throw away whatever the previous one stored. Dot paths let Mongo write each
    // key on its own and leave the siblings alone.
    if (response !== undefined) {
      for (const [key, value] of Object.entries(response)) {
        update[`response.${key}`] = value;
      }
    }

    await this.enrichModel.updateOne({ _id: songId as any }, { $set: update }, { upsert: true });
  }

  getEnrichCursor(type: EnrichType, status: EnrichState = 'queued', limit?: number) {
    let query = this.enrichModel.find({ [`status.${type}`]: status });
    if (limit && limit > 0) {
      query = query.limit(limit);
    }
    return query.cursor();
  }

  async getEnrichItems(type: EnrichType, status: EnrichState = 'queued'): Promise<EnrichDocument[]> {
    return this.enrichModel.find({ [`status.${type}`]: status }).exec();
  }

  /**
   * @param ids
   * @param activeSourcesOnly - when `true`, songs that are not available on any source listed in
   *   `ACTIVE_SOURCE_TYPES` are dropped. The agentic path passes `true`; the CLI keeps the default
   *   so enrichment and maintenance still see the whole library.
   */
  async getPopulatedSongsByIds(ids: string[], activeSourcesOnly = false): Promise<PopulatedSong[]> {
    const filter: Record<string, unknown> = { _id: { $in: ids } };
    if (activeSourcesOnly) {
      Object.assign(filter, this.activeSourceMatch() ?? {});
    }

    const results = await this.songModel
      .find(filter)
      .populate('artist')
      .populate('album')
      .exec();
    return z.array(PopulatedSongSchema).parse(results);
  }

  /**
   * The most recent entry of the playlog, with its song populated.
   *
   * This is the database's own record of what is playing: `PlaylogService`
   * writes a row on every track change, so the latest row is the current track
   * for as long as the server is running. Under `IS_CLI` that poller is off,
   * which is why `playedAt` comes back with the song — a caller reading this
   * from a one-shot command needs to see how stale the answer is.
   */
  async getLastPlayedSong(): Promise<LastPlayedSong | null> {
    const playlog = await this.playlogModel.findOne().sort({ playedAt: -1 }).exec();

    if (!playlog) {
      return null;
    }

    const [song] = await this.getPopulatedSongsByIds([playlog.songId.toString()]);

    if (!song) {
      this.logger.warn(`Playlog ${playlog._id} points at song ${playlog.songId}, which no longer exists`);
      return null;
    }

    return { playedAt: playlog.playedAt, song };
  }

  async getRecentlyPlayedArtist(): Promise<RecentlyPlayedArtist[]> {
    const results: unknown[] = await this.playlogModel.aggregate([
        {
          $group: {
            _id: '$artist',
            lastPlayedAt: { $max: '$playedAt' },
          },
        },
        { $sort: { lastPlayedAt: -1 } },
        { $limit: 50 },
        {
          $lookup: {
            from: 'artists',
            let: { artistIdStr: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [{ $eq: ['$_id', '$$artistIdStr'] }, { $eq: [{ $toString: '$_id' }, '$$artistIdStr'] }],
                  },
                },
              },
            ],
            as: 'artistDetails',
          },
        },
        {
          $unwind: {
            path: '$artistDetails',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 0,
            artist: '$artistDetails.artist',
            playedAt: {
              $substrCP: [{ $toString: '$lastPlayedAt' }, 0, 16],
            },
          },
        },
      ]).exec();

    // The $lookup preserves playlog rows whose artist document is gone, so those come back
    // without an `artist` field — drop them instead of failing the whole batch.
    const parsed = results.flatMap((row) => {
      const result = RecentlyPlayedArtistSchema.safeParse(row);
      return result.success ? [result.data] : [];
    });

    if (parsed.length !== results.length) {
      this.logger.warn(`Discarded ${results.length - parsed.length} recently played rows with no resolvable artist`);
    }

    return parsed;
  }

  /**
   * Reactions summed over every play of each song, keyed by song id. Songs that were never reacted
   * to are absent from the map - a play with no reaction says nothing, and the caller must not read
   * absence as dislike.
   *
   * `songId` is compared as a string on both sides so rows written before the ref was typed as an
   * ObjectId still count. The playlog is small enough that skipping the index does not matter.
   */
  async getSongReactions(songIds: string[]): Promise<Map<string, SongReactions>> {
    if (songIds.length === 0) return new Map();

    const results: unknown[] = await this.playlogModel
      .aggregate([
        { $match: { $expr: { $in: [{ $toString: '$songId' }, songIds] } } },
        {
          $group: {
            _id: { $toString: '$songId' },
            plays: { $sum: 1 },
            awesome: { $sum: { $ifNull: ['$feedback.awesome', 0] } },
            great: { $sum: { $ifNull: ['$feedback.great', 0] } },
            duh: { $sum: { $ifNull: ['$feedback.duh', 0] } },
            wtf: { $sum: { $ifNull: ['$feedback.wtf', 0] } },
          },
        },
        { $match: { $expr: { $gt: [{ $add: ['$awesome', '$great', '$duh', '$wtf'] }, 0] } } },
        { $project: { _id: 0, songId: '$_id', plays: 1, awesome: 1, great: 1, duh: 1, wtf: 1 } },
      ])
      .exec();

    const reactions = new Map<string, SongReactions>();
    for (const row of results) {
      const parsed = SongReactionsSchema.safeParse(row);
      if (parsed.success) {
        reactions.set(parsed.data.songId, parsed.data);
      } else {
        this.logger.warn(`Discarded a reaction row that failed validation: ${JSON.stringify(row)}`);
      }
    }

    return reactions;
  }

  /**
   * Resolves a song by one of its source identifiers — the reverse of what the
   * importers write, and how an MPD queue entry is turned back into a document.
   */
  async findSongBySource(name: SourceType, sourceId: string): Promise<SongDocument | null> {
    return this.songModel.findOne({ source: { $elemMatch: { name, sourceId } } }).exec();
  }

  /**
   * The same lookup as {@link findSongBySource}, with artist and album resolved.
   *
   * What a caller holding an MPD queue uri wants: the queue is mixed across services, so the source
   * it resolves to is whatever `parseSourceUri` reported — a local path, a Qobuz id, a Spotify id —
   * and the answer has to carry enough to describe the track, not just point at it.
   */
  async findPopulatedSongBySource(name: SourceType, sourceId: string): Promise<PopulatedSong | null> {
    if (!isSourceActive(name)) {
      this.logger.warn(`findPopulatedSongBySource called while the ${name} source is inactive`);
    }

    const song = await this.songModel
      .findOne({ source: { $elemMatch: { name, sourceId } } })
      .populate('artist')
      .populate('album')
      .exec();

    return song ? PopulatedSongSchema.parse(song) : null;
  }

  /**
   * Attaches an additional source to a song, keeping the multi-source model's
   * one-document-per-logical-song rule.
   *
   * Idempotent by `(name, sourceId)`: the caller may be racing another pass over
   * the same song, and a second copy of the same source would give
   * `getBestSource` two identical candidates to choose between.
   *
   * @returns `true` when the source was added, `false` when it was already there
   */
  async addSongSource(songId: string, source: SongSource): Promise<boolean> {
    const result = await this.songModel
      .updateOne(
        {
          _id: songId,
          source: { $not: { $elemMatch: { name: source.name, sourceId: source.sourceId } } },
        },
        { $push: { source } },
      )
      .exec();

    return result.modifiedCount > 0;
  }

  /**
   * Fills in album artwork, but never overwrites artwork that is already there.
   *
   * The importers set this at album creation; songs that reached the library
   * through another source can end up on an album with none, which is what
   * sends the now-playing page off to a web search for a cover. A provider that
   * hands us one for free closes that gap.
   *
   * The match treats missing, `null` and `''` alike — Mongo returns documents
   * with no such path for `$in: [null, ...]` — so the update only lands on
   * albums with nothing usable in any size.
   *
   * @returns `true` when the artwork was written, `false` when the album already had some
   */
  async setAlbumImageIfMissing(albumId: string | Types.ObjectId, image: AlbumImage): Promise<boolean> {
    if (!image.small && !image.thumbnail && !image.large && !image.back) {
      return false;
    }

    const result = await this.albumModel
      .updateOne(
        {
          _id: albumId,
          'image.large': { $in: [null, ''] },
          'image.thumbnail': { $in: [null, ''] },
          'image.small': { $in: [null, ''] },
        },
        { $set: { image } },
      )
      .exec();

    return result.modifiedCount > 0;
  }

  async getSongs(createdAt?: Date): Promise<SongDocument[]> {
    const filter = createdAt ? { createdAt: { $gte: createdAt } } : {};
    return await this.songModel.find(filter).exec();
  }

  async getSongById(id: string): Promise<SongDocument | null> {
    return await this.songModel.findById(id).exec();
  }

  async getArtistDistribution(): Promise<{ artist: string; count: number }[]> {
    return await this.songModel
      .aggregate([
        ...this.activeSourceStage(),
        {
          $group: {
            _id: '$artist',
            count: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: 'artists', // The name of the target collection
            localField: '_id', // The grouped _id (the artist's ObjectId)
            foreignField: '_id', // The _id field in the artists collection
            as: 'artist_info', // The new array field to store the joined data
          },
        },
        {
          $unwind: '$artist_info',
        },
        {
          $project: {
            _id: 0,
            artistName: '$artist_info.artist',
            count: 1,
          },
        },
        {
          $sort: { count: -1 },
        },
      ])
      .exec();
  }

  async getGenreDistribution(): Promise<{ genre: string; count: number }[]> {
    return await this.songModel
      .aggregate([
        ...this.activeSourceStage(),
        {
          $group: {
            _id: '$genre',
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            genre: '$_id',
            count: 1,
          },
        },
        {
          $sort: { count: -1 },
        },
      ])
      .exec();
  }

  async getBPMDistribution(): Promise<{ bpm: number; count: number }[]> {
    const activeSources = getActiveSourceTypes();

    return this.songModel
      .aggregate([
        ...this.activeSourceStage(),
        {
          $unwind: '$source',
        },
        {
          $match: {
            'source.technical_info.bpm': { $exists: true, $ne: null },
            // The song survived the stage above because *some* source is active - make sure the
            // BPM that wins the $max below did not come from an inactive one.
            ...(activeSources ? { 'source.name': { $in: activeSources } } : {}),
          },
        },
        {
          $group: {
            _id: '$_id',
            bpm: { $max: '$source.technical_info.bpm' },
          },
        },
        {
          $group: {
            _id: '$bpm',
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            bpm: '$_id',
            count: 1,
          },
        },
        {
          $sort: { count: -1 },
        },
      ])
      .exec();
  }

  async getAllPopulatedSongs(createdAfter?: Date): Promise<PopulatedSong[]> {
    const filter = createdAfter ? { createdAt: { $gte: createdAfter } } : {};
    const results = await this.songModel.find(filter).populate('artist').populate('album').exec();
    return z.array(PopulatedSongSchema).parse(results);
  }

  async upsertSong(song: SongDocument): Promise<SongDocument> {
    const { _id, ...updateFields } = song;

    return await this.songModel
      .findByIdAndUpdate(
        _id, // 1. The Filter: Match by ID
        { $set: updateFields }, // 2. The Update: Set the new fields
        {
          returnDocument: 'after', // Replaces 'new: true'
          upsert: true, // Create a new document if one doesn't exist
          runValidators: true,
          setDefaultsOnInsert: true, // Apply schema defaults if a new one is created
        },
      )
      .exec();
  }

  /**
   * Runs an LLM-authored pipeline. Song pipelines are prefixed with the active-source match so a
   * hallucinated or over-broad pipeline still cannot surface unplayable songs. Artists and albums
   * are left alone on purpose: their `source[]` records where the *document* came from, so
   * filtering there would hide an artist whose songs are perfectly playable from another source.
   */
  async aggregate(collection: string, params: any): Promise<MusicDbAggregateResult[]> {
    if (collection === 'artists') {
      return this.artistModel.aggregate(params);
    } else if (collection === 'albums') {
      return this.albumModel.aggregate(params);
    } else if (collection === 'songs') {
      const pipeline = Array.isArray(params) ? [...this.activeSourceStage(), ...params] : params;
      return this.songModel.aggregate(pipeline);
    } else {
      throw new Error('Unsupported collection');
    }
  }

  /**
   * Runs LLM-authored filter definitions and returns the songs each one yielded,
   * tagged with the intent it was generated for.
   *
   * Conditions targeting `artists` / `albums` are resolved to ids first and folded into
   * the song match through the `artist` / `album` refs. Unknown fields are dropped by
   * {@link buildMatch}, so a definition whose filters were all hallucinated returns
   * nothing rather than sampling the entire library.
   *
   * @param definitions - Query definitions as parsed from the model response
   * @param sampleSize - Upper bound of songs drawn per definition via `$sample`
   */
  async findByMongoWrapper(definitions: MongoQueryDefinition[], sampleSize = 300): Promise<MongoWrapperResult[]> {
    const results: MongoWrapperResult[] = [];

    for (const definition of definitions) {
      const items = await this.runQueryDefinition(definition, sampleSize);
      this.logger.log(`"${definition.description}" -> ${items.length} songs`);
      results.push({ intent: definition.description, items });
    }

    return results;
  }

  private async runQueryDefinition(definition: MongoQueryDefinition, sampleSize: number): Promise<PopulatedSong[]> {
    const conditionsFor = (collection: FilterCollection): FilterCondition[] =>
      definition.filters.filter((filter) => filter.collection === collection);

    const match: MongoMatch = buildMatch(this.songModel.schema as SchemaPathResolver, conditionsFor('songs')) ?? {};
    let constrained = Object.keys(match).length > 0;

    const artistIds = await this.resolveRefIds(this.artistModel, conditionsFor('artists'));
    if (artistIds) {
      if (artistIds.length === 0) {
        this.logger.warn(`No artist matched for "${definition.description}"`);
        return [];
      }
      match.artist = { $in: artistIds };
      constrained = true;
    }

    const albumIds = await this.resolveRefIds(this.albumModel, conditionsFor('albums'));
    if (albumIds) {
      if (albumIds.length === 0) {
        this.logger.warn(`No album matched for "${definition.description}"`);
        return [];
      }
      match.album = { $in: albumIds };
      constrained = true;
    }

    // Never fall through to an unfiltered $sample of the whole collection.
    if (!constrained) {
      this.logger.warn(`No usable filter survived for "${definition.description}" - skipping`);
      return [];
    }

    // The active-source match is a separate stage rather than a merge into `match`: the LLM filter
    // may already carry a `source` key, and merging would silently drop one of the two.
    const sampled = await this.songModel
      .aggregate([{ $match: match }, ...this.activeSourceStage(), { $sample: { size: sampleSize } }])
      .exec();
    const ids = sampled.map((song) => song._id.toString());
    if (ids.length === 0) {
      return [];
    }

    return this.getPopulatedSongsByIds(ids, true);
  }

  /**
   * @returns the matching ids, or `null` when there was nothing usable to resolve —
   *   which the caller must distinguish from an empty match (no such artist/album).
   */
  private async resolveRefIds<T>(model: Model<T>, conditions: FilterCondition[]): Promise<Types.ObjectId[] | null> {
    if (conditions.length === 0) {
      return null;
    }
    const match = buildMatch(model.schema as SchemaPathResolver, conditions);
    if (!match) {
      return null;
    }
    return (await model.distinct('_id', match as QueryFilter<T>).exec()) as Types.ObjectId[];
  }

  /** The `$match` fragment restricting songs to the currently active sources, or `null`. */
  private activeSourceMatch(): Record<string, unknown> | null {
    return buildActiveSourceMatch();
  }

  /** Spreadable form of {@link activeSourceMatch} - an empty array when nothing is restricted. */
  private activeSourceStage(): PipelineStage.Match[] {
    const match = this.activeSourceMatch();
    return match ? [{ $match: match as Record<string, any> }] : [];
  }

  getSchema(collection: string): any {
    if (collection === 'artists') return this.artistModel.schema;
    if (collection === 'albums') return this.albumModel.schema;
    if (collection === 'songs') return this.songModel.schema;
    throw new Error('Unsupported collection');
  }

  private getSourceId(song: Song, type: SourceType): string | null {
    return song?.source?.find((m) => m.name === type)?.sourceId || null;
  }

  isAlbum(document: MusicDbAggregateResult): boolean {
    return 'release_year' in document;
  }

  isArtist(document: MusicDbAggregateResult): boolean {
    return 'albums' in document && Array.isArray((document as any).albums);
  }

  isSong(document: MusicDbAggregateResult): boolean {
    return 'source' in document && Array.isArray((document as any).source);
  }
}
