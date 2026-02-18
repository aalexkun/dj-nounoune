import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Model } from 'mongoose';
import { SourceType } from '../../schemas/source.schema';

export type MusicDbAggregateResult = ArtistDocument | AlbumDocument | SongDocument;

export type PopulatedSong = Omit<SongDocument, 'artist' | 'album'> & {
  artist: Artist;
  album: Album;
};

@Injectable()
export class MusicDbService {
  private readonly logger = new Logger(MusicDbService.name);
  constructor(
    @InjectModel(Artist.name) private artistModel: Model<ArtistDocument>,
    @InjectModel(Album.name) private albumModel: Model<AlbumDocument>,
    @InjectModel(Song.name) private songModel: Model<SongDocument>,
  ) {}

  async getAllSongs(): Promise<SongDocument[]> {
    return await this.songModel.find().exec();
  }

  async getAllPopulatedSongs(): Promise<PopulatedSong[]> {
    return (await this.songModel.find().populate('artist').populate('album').exec()) as any;
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
