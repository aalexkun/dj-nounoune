import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Enrich, EnrichDocument } from '../../schemas/enrich.schema';
import { Model, PipelineStage, QueryFilter, Types } from 'mongoose';
import { SourceType } from '../../schemas/source.schema';
import { buildActiveSourceMatch, getActiveSourceTypes, isSourceActive } from '../../config/active-source.util';
import { z } from 'zod';
import { FilterCollection, FilterCondition, MongoQueryDefinition } from './mongo-filter.type';
import { buildMatch, MongoMatch, SchemaPathResolver } from './mongo-filter.util';
import { Playlog, PlaylogDocument } from '../../schemas/playlog.schema';

export type MusicDbAggregateResult = ArtistDocument | AlbumDocument | SongDocument;

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

export type QobuzLookupResult = {
  artist: string;
  album: string;
  title: string;
}

/** One row of the recently-played aggregation: artist name and the minute-precision timestamp it was last played at. */
export const RecentlyPlayedArtistSchema = z.object({
  artist: z.string(),
  playedAt: z.string(),
});

export type RecentlyPlayedArtist = z.infer<typeof RecentlyPlayedArtistSchema>;

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
  }

  async updateEnrichStatus(
    songId: string,
    type: 'ai' | 'bpm' | 'ffprobe',
    status: 'completed' | 'queued' | 'notApplicable',
    message?: string,
    response?: any,
  ): Promise<void> {
    const update: any = { [`status.${type}`]: status };
    if (message !== undefined) update.message = message;
    if (response !== undefined) update.response = response;
    await this.enrichModel.updateOne({ _id: songId as any }, { $set: update }, { upsert: true });
  }

  getEnrichCursor(type: 'ai' | 'bpm' | 'ffprobe', status: 'queued' | 'completed' | 'notApplicable' = 'queued', limit?: number) {
    let query = this.enrichModel.find({ [`status.${type}`]: status });
    if (limit && limit > 0) {
      query = query.limit(limit);
    }
    return query.cursor();
  }

  async getEnrichItems(type: 'ai' | 'bpm' | 'ffprobe', status: 'queued' | 'completed' | 'notApplicable' = 'queued'): Promise<EnrichDocument[]> {
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

  async getSongs(createdAt?: Date): Promise<SongDocument[]> {
    const filter = createdAt ? { createdAt: { $gte: createdAt } } : {};
    return await this.songModel.find(filter).exec();
  }

  async getSongById(id: string): Promise<SongDocument | null> {
    return await this.songModel.findById(id).exec();
  }

  async getSongByQobuzId(qobuzId: string): Promise<QobuzLookupResult | null> {
    if (!isSourceActive('qobuz')) {
      this.logger.warn('getSongByQobuzId called while the qobuz source is inactive');
    }

    const results = await this.songModel
      .aggregate([
        {
          $match: {
            source: {
              $elemMatch: {
                name: 'qobuz',
                sourceId: qobuzId,
              },
            },
          },
        },
        {
          $lookup: {
            from: 'artists',
            localField: 'artist',
            foreignField: '_id',
            as: 'artist_info',
          },
        },
        {
          $lookup: {
            from: 'albums',
            localField: 'album',
            foreignField: '_id',
            as: 'album_info',
          },
        },
      ])
      .exec();

    const songModel = Array.isArray(results) && results.length > 0 ? results[0] : null;

    if (songModel && typeof songModel === 'object' && 'title' in songModel && typeof songModel.title === 'string') {
      let artist = '';
      let album = '';
      let title = songModel.title;

      if ('artist_info' in songModel) {
        const artistInfo = Array.isArray(songModel.artist_info) ? songModel.artist_info[0] : songModel.artist_info;
        if (artistInfo && typeof artistInfo === 'object' && 'artist' in artistInfo && typeof artistInfo.artist === 'string') {
          artist = artistInfo.artist;
        }
      }

      if ('album_info' in songModel) {
        const albumInfo = Array.isArray(songModel.album_info) ? songModel.album_info[0] : songModel.album_info;
        if (albumInfo && typeof albumInfo === 'object' && 'title' in albumInfo && typeof albumInfo.title === 'string') {
          album = albumInfo.title;
        }
      }

      return {
        artist,
        album,
        title,
      };
    } else {
      this.logger.error('getSongByQobuzId: Unexpected song model:', songModel);
      return null;
    }
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
