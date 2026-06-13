import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Model } from 'mongoose';
import { SourceType } from '../../schemas/source.schema';

export type MusicDbAggregateResult = ArtistDocument | AlbumDocument | SongDocument;

export type PopulatedSong = Omit<SongDocument, 'artist' | 'album'> & {
  artist: ArtistDocument;
  album: AlbumDocument;
};

export type QobuzLookupResult = {
  artist: string;
  album: string;
  title: string;
}

@Injectable()
export class MusicDbService {
  private readonly logger = new Logger(MusicDbService.name);
  constructor(
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {}

  async getSongs(createdAt?: Date): Promise<SongDocument[]> {
    const filter = createdAt ? { createdAt: { $gte: createdAt } } : {};
    return await this.songModel.find(filter).exec();
  }

  async getSongByQobuzId(qobuzId: string): Promise<QobuzLookupResult | null> {
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

      if ('album_info' in songModel){
        const albumInfo = Array.isArray(songModel.album_info) ? songModel.album_info[0] : songModel.album_info;
        if(albumInfo && typeof albumInfo === 'object' && 'title' in albumInfo && typeof albumInfo.title === 'string') {
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
    return this.songModel
      .aggregate([
        {
          $unwind: '$source',
        },
        {
          $match: {
            'source.technical_info.bpm': { $exists: true, $ne: null },
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
    return (await this.songModel.find(filter).populate('artist').populate('album').exec()) as any;
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

  async aggregate(collection: string, params: any): Promise<MusicDbAggregateResult[]> {
    if (collection === 'artists') {
      return this.artistModel.aggregate(params);
    } else if (collection === 'albums') {
      return this.albumModel.aggregate(params);
    } else if (collection === 'songs') {
      return this.songModel.aggregate(params);
    } else {
      throw new Error('Unsupported collection');
    }
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
