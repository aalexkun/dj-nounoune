import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { ZentityResolutionResponseSchema, ZentityResolutionResponse, ZentityHitSchema, ZentityHit, ZentityExplanationMatch } from './types';
import { PopulatedSong } from '../music-db/music-db.service';
import { SongEntity } from './models/SongEntity';
import { SongIndices } from './models/SongIndices';

@Injectable()
export class ElasticsearchService {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly client: Client;

  constructor(private readonly configService: ConfigService) {
    const node = this.configService.get<string>('ELASTIC_NODE');
    const username = this.configService.get<string>('ELASTIC_USERNAME');
    const password = this.configService.get<string>('ELASTIC_PASSWORD');
    const certBase64 = this.configService.get<string>('ELASTIC_CERTIFICATE');

    if (!node) {
      this.logger.warn('ELASTIC_NODE is not defined, Elasticsearch client will not be initialized');
      return;
    }

    const auth = username && password ? { username, password } : undefined;
    const ca = certBase64 ? Buffer.from(certBase64, 'base64') : undefined;

    this.client = new Client({
      node,
      auth,
      tls: ca ? { ca } : undefined,
    });
  }

  async createIndex(): Promise<boolean> {
    this.logger.log('Creating songs index with CJK normalization settings...');

    try {
      // Check if index exists
      const exists = await this.client.indices.exists({ index: 'songs' });
      if (exists) {
        this.logger.warn('Index "songs" already exists. Prune it first to recreate.');
        return false;
      }

      // Create index with mapping and settings for CJK plugins
      await this.client.indices.create({
        index: SongIndices.name,
        settings: SongIndices.settings,
        mappings: SongIndices.mappings,
      });

      // 2. Register the Zentity Model
      this.logger.log('Registering Zentity identity model for "song"...');

      // We use client.request() because Zentity endpoints are not natively typed in the official client
      const response = (await this.client.transport.request({
        method: 'POST',
        path: `${SongEntity.path}/models/${SongEntity.model}`,
        body: SongEntity.getBody(), // The model definition from the previous step
      })) as Record<string, unknown>;

      if (response?.statusCode === 200 || response?.statusCode === 201) {
        this.logger.log('Successfully registered Zentity model: song_entity.');
      }

      this.logger.log('Songs index created successfully.');
      return true;
    } catch (error) {
      this.logger.error(`Failed to create index "songs": ${error.message}`, error.stack);
      return false;
    }
  }

  async pruneIndex() {
    this.logger.log('Pruning songs index...');
    const exists = await this.client.indices.exists({ index: 'songs' });
    if (exists) {
      await this.client.indices.delete({ index: 'songs' });
      this.logger.log('Songs index deleted successfully.');
    } else {
      this.logger.warn('Index "songs" does not exist.');
    }

    this.logger.log('Deleting Zentity identity model "song_entity"...');
    await this.client.transport.request({
      method: 'DELETE',
      path: `${SongEntity.path}/models/${SongEntity.model}`,
    });
    this.logger.log('Successfully deleted Zentity model: song_entity.');
  }

  async indexSongs(songs: PopulatedSong[]) {
    this.logger.log(`Indexing ${songs.length} songs...`);
    if (songs.length === 0) return;

    for (const song of songs) {
      const songAttributes = {
        title: song.title,
        artist: song.artist.artist || '', // Using album_artist as fallback
        album: song.album.title || '',
      };

      const duplicates = await this.findDuplicates(songAttributes);
      if (duplicates && duplicates.hits.hits.length > 0) {
        this.logger.log(
          `Duplicate found for song: "${song.title}" by "${songAttributes.artist}" - "${songAttributes.album}" => ${song._id.toString()}`,
        );
        duplicates.hits.hits.forEach((hit: ZentityHit) => {
          this.logger.warn(`      song: "${hit['_source'].title}" by "${hit['_source'].artist}" - "${hit['_source'].album}" => ${hit['_id']}`);

          hit['_explanation']?.matches?.forEach((match: ZentityExplanationMatch) => {
            this.logger.debug(`        Explanation match: ${match.attribute} => ${match.target_field} : ${match.target_value}`);
          });

        });

      }

      try {
        await this.client.index({
          index: 'songs',
          id: song._id.toString(),
          document: {
            ...songAttributes,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to index song ${song._id}: ${error.message}`);
      }

    }

    this.logger.log(`Successfully processed ${songs.length} songs.`);
  }

  private escapeZentityAttributes(str: string): string {
    const punctuationRegex = /[^\p{L}\p{Nd}\s]/gu;

    // Replace matched punctuation with an empty string, and trim excess spaces
    return str.replace(punctuationRegex, '').replace(/\s+/g, ' ').trim();
  }


  async findDuplicates(songAttributes: { title: string; artist: string; album?: string }): Promise<ZentityResolutionResponse | null> {
    const attributes = {
      title: [this.escapeZentityAttributes(songAttributes.title)],
      artist: [this.escapeZentityAttributes(songAttributes.artist)],
      album: [this.escapeZentityAttributes(songAttributes.album || '')],
    };

    const body = JSON.stringify({ attributes });

    try {

      const response = await this.client.transport.request(
        {
        method: 'POST',
        path: `${SongEntity.path}/resolution/${SongEntity.model}`,
        querystring: {
          _explanation: true
        },
        body
        },
        {
          headers: {
            'content-type': 'application/json'
          }
        }
          );

      // Validate the response using Zod
      const parsedResponse = ZentityResolutionResponseSchema.safeParse(response);
      if (parsedResponse.success) {
        return parsedResponse.data;
      } else {
        this.logger.error('Zentity response validation failed', parsedResponse.error);
        return null;
      }
    } catch (error) {
      this.logger.error('Error querying Zentity API', error.message);
      this.logger.error('Error querying Zentity API', attributes);
      return null;
    }
  }
}
