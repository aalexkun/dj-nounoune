import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Artist, ArtistDocument } from '../../schemas/artist.schema';
import { Album, AlbumDocument } from '../../schemas/albums.schema';
import { Song, SongDocument } from '../../schemas/song.schema';
import { Model } from 'mongoose';
import { SourceType } from '../../schemas/source.schema';

export type MusicDbAggregateResult = ArtistDocument | AlbumDocument | SongDocument;
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

  getSourceIdFromAggregateResult(type: SourceType, documents: MusicDbAggregateResult[]): string[] {
    let sourceIds: string[] = [];

    this.logger.debug(`Getting source IDs for type ${type} from ${documents.length} documents`);
    this.logger.debug(JSON.stringify(documents, null, 2));

    if (Array.isArray(documents)) {
      if (documents.length > 0) {
        const firstDocument = documents[0];

        if (this.isAlbum(firstDocument)) {
          for (const document of documents) {
            if (document['tracks_details']?.length > 0) {
              for (const track of document['tracks_details']) {
                const song = Object.assign(new Song(), track);
                const sourceId = this.getSourceId(song, type);
                if (sourceId) {
                  sourceIds.push(sourceId);
                }
              }
            }
          }
        } else if (this.isSong(firstDocument)) {
          this.logger.debug(`Found ${documents.length} documents of type ${type}`);
          for (const document of documents) {
            const song = Object.assign(new Song(), document);
            const sourceId = this.getSourceId(song, type);
            if (sourceId) {
              sourceIds.push(sourceId);
            }
          }
        } else if (this.isArtist(firstDocument)) {
          for (const document of documents) {
            if (document['albums']?.length > 0) {
              for (const album of document['albums']) {
                if (album['tracks_details']?.length > 0) {
                  for (const track of album['tracks_details']) {
                    const song = Object.assign(new Song(), track);
                    const sourceId = this.getSourceId(song, type);
                    if (sourceId) {
                      sourceIds.push(sourceId);
                    }
                  }
                }
              }
            }
          }
        } else {
          this.logger.error('Document could not match any type: ' + JSON.stringify(firstDocument, null, 2));
        }
      } else {
        this.logger.warn('No documents found for aggregation');
      }
    } else {
      this.logger.error('Unsupported documents type, must be an array of documents');
    }

    return sourceIds;
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
