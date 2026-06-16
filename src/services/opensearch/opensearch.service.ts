import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { PopulatedSong } from '../music-db/music-db.service';
import { NeuralSearch, SongIndices } from './models/SongIndices';
import {
  MlTaskSchema,
  MlModelGroupRegisterResponseSchema,
  MlModelGroupSearchResponseSchema,
  MlModelSearchResponseSchema,
  OpenSearchSearchResponseSchema,
  OpenSearchSearchResponse, OpenSearchArtistSearchResponse, OpenSearchArtistSearchResponseSchema,
  OpenSearchAlbumSearchResponse, OpenSearchAlbumSearchResponseSchema,
} from './types';
import { SearchSongQuery } from './search-song.query';
import { ArtistSearchQuery } from './search-artist.query';
import { AlbumSearchQuery } from './search-album.query';
import { generateDynamicMappings } from './dynamic-mapping.util';
import { SongSchema } from '../../schemas/song.schema';
import { ArtistSchema } from '../../schemas/artist.schema';
import { AlbumSchema } from '../../schemas/albums.schema';


export type DuplicateSongCheck = {
  songId: string;
  track_number: number;
  disc_number: number;
  year: string;
  title: string;
  artist: string;
  album: string;
}



@Injectable()
export class OpensearchService {
  private readonly logger = new Logger(OpensearchService.name);
  private readonly client: Client | null = null;
  private modelId: string | null = null;




  constructor(private readonly configService: ConfigService) {
    const node = this.configService.get<string>('OPENSEARCH_NODE') || this.configService.get<string>('ELASTIC_NODE');
    const username = this.configService.get<string>('OPENSEARCH_USERNAME') || this.configService.get<string>('ELASTIC_USERNAME');
    const password = this.configService.get<string>('OPENSEARCH_PASSWORD') || this.configService.get<string>('ELASTIC_PASSWORD');

    if (!node) {
      this.logger.warn('OPENSEARCH_NODE (or ELASTIC_NODE) is not defined, OpenSearch client will not be initialized');
      return;
    }

    const auth = username && password ? { username, password } : undefined;
    const ssl = node.startsWith('https://') ? { rejectUnauthorized: false } : undefined;

    this.client = new Client({
      node,
      auth,
      ssl,
    });
  }

  private async getDeployedModelId(): Promise<string | null> {
    if (!this.client) return null;
    if (this.modelId) return this.modelId;

    try {
      this.logger.log('Searching for deployed ML model...');
      const response = await this.client.transport.request({
        method: 'POST',
        path: '/_plugins/_ml/models/_search',
        body: {
          size: 1000,
          query: {
            term: {
              'name.keyword': NeuralSearch.Model,
            },
          },
        },
      });

      const parsed = MlModelSearchResponseSchema.safeParse(response.body);
      if (parsed.success && parsed.data.hits.hits.length > 0) {
        const parentModel = parsed.data.hits.hits.find((h) => h._source.chunk_number === undefined && h._source.model_state === 'DEPLOYED');

        if (parentModel) {
          const state = parentModel._source.model_state;
          this.modelId = parentModel._id;
          this.logger.log(`Found parent model ${this.modelId} with state: ${state}`);
          return this.modelId;
        }
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to find deployed model: ${err.message}`);
    }

    return null;
  }

  private async pollTask(taskId: string): Promise<string> {
    if (!this.client) throw new Error('OpenSearch client is not initialized');

    this.logger.log(`Polling task status for task ID: ${taskId}...`);
    const maxRetries = 30;
    const delayMs = 2000;

    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const response = await this.client.transport.request({
        method: 'GET',
        path: `/_plugins/_ml/tasks/${taskId}`,
      });

      const parsed = MlTaskSchema.safeParse(response.body);
      if (!parsed.success) {
        this.logger.error('ML task response validation failed', parsed.error);
        throw new Error('ML task response validation failed');
      }

      const task = parsed.data;
      this.logger.log(`Task state: ${task.state}`);

      if (task.state === 'COMPLETED') {
        if (task.model_id) {
          return task.model_id;
        }
        throw new Error('Task completed but no model_id was returned');
      } else if (task.state === 'FAILED' || task.state === 'COMPLETED_WITH_ERROR') {
        throw new Error(`Task failed: ${task.error || 'Unknown error'}`);
      }
    }

    throw new Error('ML task timed out');
  }

  async createIndex(): Promise<boolean> {
    if (!this.client) {
      this.logger.error('OpenSearch client is not initialized');
      return false;
    }

    this.logger.log('Starting OpenSearch index and model creation process...');


    this.logger.log('Configure Cluster Settings');
    try {
      // 0 Configure Cluster Settings
      const settingResonse = await this.client.transport.request({
        method: 'PUT',
        path: '/_cluster/settings',
        body: {
          persistent: {
            'plugins.ml_commons.only_run_on_ml_node': false,
            'plugins.ml_commons.model_access_control_enabled': true,
          },
        },
      });

      // 1. Register or find Model Group
      this.logger.log('Checking for existing Model Group "song_model_group"...');
      let modelGroupId: string | null = null;

      const groupSearchRes = await this.client.transport.request({
        method: 'POST',
        path: '/_plugins/_ml/model_groups/_search',
        body: {
          size: 1000,
          query: {
            term: {
              'name.keyword': 'song_model_group',
            },
          },
        },
      });

      const parsedGroupSearch = MlModelGroupSearchResponseSchema.safeParse(groupSearchRes.body);

      if (parsedGroupSearch.success && parsedGroupSearch.data.hits.hits.length > 0) {
        modelGroupId = parsedGroupSearch.data.hits.hits[0]._id;
        this.logger.log(`Using existing Model Group: ${modelGroupId}`);
      } else {
        this.logger.log('Model Group not found. Registering "song_model_group"...');
        const registerGroupRes = await this.client.transport.request({
          method: 'POST',
          path: '/_plugins/_ml/model_groups/_register',
          body: {
            name: 'song_model_group',
            description: 'Model group for song neural search',
          },
        });

        const parsedRegister = MlModelGroupRegisterResponseSchema.safeParse(registerGroupRes.body);
        if (!parsedRegister.success) {
          throw new Error('Failed to register model group: schema mismatch');
        }

        modelGroupId = parsedRegister.data.model_group_id;
        this.logger.log(`Registered new Model Group: ${modelGroupId}`);
      }

      // 2. Register Model
      this.logger.log('Checking if model is registered and deployed...');
      let modelId = await this.getDeployedModelId();

      if (!modelId) {
        this.logger.log('Model not found in DEPLOYED state. Searching for any registered parent model...');
        const searchRes = await this.client.transport.request({
          method: 'POST',
          path: '/_plugins/_ml/models/_search',
          body: {
            size: 1000,
            query: {
              term: {
                'name.keyword': NeuralSearch.Model,
              },
            },
          },
        });

        const parsed = MlModelSearchResponseSchema.safeParse(searchRes.body);
        let existingParentModelId: string | null = null;
        if (parsed.success && parsed.data.hits.hits.length > 0) {
          const parentModel = parsed.data.hits.hits.find((h) => h._source.chunk_number === undefined);
          if (parentModel) {
            existingParentModelId = parentModel._id;
            this.logger.log(`Found existing registered parent model: ${existingParentModelId}`);
          }
        }

        if (existingParentModelId) {
          modelId = existingParentModelId;
          this.modelId = modelId;
        } else {
          this.logger.log(`Registering model ${NeuralSearch.Model}`);
          const registerModelRes = await this.client.transport.request({
            method: 'POST',
            path: '/_plugins/_ml/models/_register?deploy=true',
            body: {
              name: NeuralSearch.Model,
              version: NeuralSearch.Version,
              model_group_id: modelGroupId,
              model_format: NeuralSearch.format,
            },
          });

          const registerBody = registerModelRes.body as Record<string, unknown>;
          const taskId = registerBody.task_id as string;
          if (!taskId) {
            throw new Error('Register model response did not return a task_id');
          }

          modelId = await this.pollTask(taskId);
          this.modelId = modelId;
          this.logger.log(`Successfully registered model: ${modelId}`);
        }
      }

      // 3. Deploy Model
      this.logger.log('Deploying the registered model...');
      try {
        const deployModelRes = await this.client.transport.request({
          method: 'POST',
          path: `/_plugins/_ml/models/${modelId}/_deploy`,
        });

        const deployBody = deployModelRes.body as Record<string, unknown>;
        const deployTaskId = deployBody.task_id as string;
        if (deployTaskId) {
          await this.pollTask(deployTaskId);
          this.logger.log('Model successfully deployed.');
        } else {
          this.logger.log('Model already deployed or task not created.');
        }
      } catch (deployError) {
        const err = deployError as Error;
        this.logger.warn(`Deploy attempt returned: ${err.message}. Assuming already deployed.`);
      }

      // 4. Create Ingest Pipeline
      this.logger.log('Creating ingest pipeline "opensearch-songs-pipeline"...');
      await this.client.transport.request({
        method: 'PUT',
        path: '/_ingest/pipeline/opensearch-songs-pipeline',
        body: {
          description: 'Text embedding pipeline for indexing songs',
          processors: [
            {
              text_embedding: {
                model_id: modelId,
                field_map: {
                  song_semantic: 'song_vector',
                },
              },
            },
          ],
        },
      });
      this.logger.log('Ingest pipeline "opensearch-songs-pipeline" created successfully.');

      // 5. Create Index
      const existsResponse = await this.client.indices.exists({
        index: 'songs',
      });
      const exists = existsResponse.body as boolean;

      if (exists) {
        this.logger.warn('Index "songs" already exists. Prune it first to recreate.');
        return false;
      }

      this.logger.log('Creating index "songs" with k-NN settings...');

      const dynamicMappings = generateDynamicMappings(SongIndices.mappings, [
        { prefix: '', schema: SongSchema as any },
        { prefix: 'artist_info', schema: ArtistSchema as any },
        { prefix: 'album_info', schema: AlbumSchema as any },
      ]);

      await this.client.indices.create({
        index: SongIndices.name,
        body: {
          settings: {
            ...SongIndices.settings,
            default_pipeline: 'opensearch-songs-pipeline',
          },
          mappings: dynamicMappings,
        } as unknown as Record<string, unknown>,
      });

      this.logger.log('Index "songs" created successfully.');
      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to create index: ${err.message}`, err.stack);
      return false;
    }
  }

  async pruneIndex(): Promise<void> {
    if (!this.client) {
      this.logger.error('OpenSearch client is not initialized');
      return;
    }

    this.logger.log('Pruning OpenSearch index...');
    try {
      const existsResponse = await this.client.indices.exists({
        index: 'songs',
      });
      const exists = existsResponse.body as boolean;

      if (exists) {
        await this.client.indices.delete({ index: 'songs' });
        this.logger.log('Index "songs" deleted successfully.');
      } else {
        this.logger.warn('Index "songs" does not exist.');
      }

      this.logger.log('Deleting ingest pipeline "opensearch-songs-pipeline"...');
      try {
        await this.client.transport.request({
          method: 'DELETE',
          path: '/_ingest/pipeline/opensearch-songs-pipeline',
        });
        this.logger.log('Pipeline "opensearch-songs-pipeline" deleted successfully.');
      } catch (pipelineErr) {
        const err = pipelineErr as Error;
        this.logger.warn(`Failed to delete pipeline: ${err.message}`);
      }

      // Undeploy ML model if found to free up cluster resources
      const modelId = await this.getDeployedModelId();
      if (modelId) {
        this.logger.log(`Undeploying model: ${modelId}`);
        try {
          await this.client.transport.request({
            method: 'POST',
            path: `/_plugins/_ml/models/${modelId}/_undeploy`,
          });
          this.logger.log('Model undeployed successfully.');
        } catch (undeployErr) {
          const err = undeployErr as Error;
          this.logger.warn(`Failed to undeploy model: ${err.message}`);
        }
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed during prune index: ${err.message}`, err.stack);
    }
  }

  async indexSongs(songs: PopulatedSong[]): Promise<void> {
    if (!this.client) {
      this.logger.error('OpenSearch client is not initialized');
      return;
    }

    for (const song of songs) {

      const songAttributes = {
        songId: song._id.toString(),
        track_number: song.track_number,
        disc_number: song.disc_number,
        year: song.year,
        title: song.title,
        artist: song.artist.artist || '',
        album: song.album.title || '',
      };

      try {
        const songObj = (typeof (song as any).toObject === 'function') ? (song as any).toObject() : song;

        await this.client.index({
          index: 'songs',
          id: songAttributes.songId,
          body: {
            ...songObj,
            artist: songAttributes.artist,
            album: songAttributes.album,
            artist_info: songObj.artist,
            album_info: songObj.album,
            artist_id: song.artist._id.toString() || '',
            album_id: song.album._id.toString() || '',
            song_semantic: `${songAttributes.artist} ${songAttributes.album} (track ${songAttributes.track_number}) ${songAttributes.title}`,
          },
        });

      } catch (error) {
        const err = error as Error;
        this.logger.error(`Failed to index song ${song._id}: ${err.message}`);
      }
    }

    this.logger.log(`Successfully processed ${songs.length} songs.`);
  }

  async deleteSong(songId: string): Promise<void> {
    if (!this.client) {
      this.logger.error('OpenSearch client is not initialized');
      return;
    }

    try {
      await this.client.delete({
        index: 'songs',
        id: songId,
      });
      this.logger.log(`Deleted song ${songId} from OpenSearch index.`);
    } catch (error) {
      const err = error as Error & { statusCode?: number; meta?: { statusCode?: number } };
      const statusCode = err.statusCode ?? err.meta?.statusCode;
      if (statusCode === 404) {
        this.logger.warn(`Song ${songId} not found in OpenSearch index, nothing to delete.`);
        return;
      }
      this.logger.error(`Failed to delete song ${songId} from OpenSearch: ${err.message}`);
    }
  }

  async findDuplicatesSongs(songAttributes: DuplicateSongCheck): Promise<OpenSearchSearchResponse | null> {
    if (!this.client) return null;

    const modelId = await this.getDeployedModelId();
    if (!modelId) {
      this.logger.warn('Cannot query neural search duplicates: No deployed model found.');
      return null;
    }
    const query = new SearchSongQuery(songAttributes, modelId);

    try {
      const response = await this.client.search({
        index: 'songs',
        body: query.getQuery(),
      });

      const parsedResponse = OpenSearchSearchResponseSchema.safeParse(response.body);

      if (parsedResponse.success) {
        return parsedResponse.data;
      } else {
        this.logger.error('OpenSearch search response validation failed', parsedResponse.error);
        return null;
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error querying OpenSearch Neural Search: ${err.message}`);
      return null;
    }
  }

  async fuzzySearchArtist(artistName: string): Promise<OpenSearchArtistSearchResponse | null> {
    if (!this.client) return null;

    const query = new ArtistSearchQuery(artistName);

    try {
      const response = await this.client.search({
        index: 'songs',
        body: query.getQuery(),
      });

      const parsedResponse = OpenSearchArtistSearchResponseSchema.safeParse(response.body);

      if (parsedResponse.success) {
        return parsedResponse.data;
      } else {
        this.logger.error('OpenSearch artist search response validation failed', parsedResponse.error);
        return null;
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error querying OpenSearch Artist Search: ${err.message}`);
      return null;
    }
  }

  async fuzzySearchAlbum(albumName: string): Promise<OpenSearchAlbumSearchResponse | null> {
    if (!this.client) return null;

    const query = new AlbumSearchQuery(albumName);

    try {
      const response = await this.client.search({
        index: 'songs',
        body: query.getQuery(),
      });

      const parsedResponse = OpenSearchAlbumSearchResponseSchema.safeParse(response.body);

      if (parsedResponse.success) {
        return parsedResponse.data;
      } else {
        this.logger.error('OpenSearch album search response validation failed', parsedResponse.error);
        return null;
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error querying OpenSearch Album Search: ${err.message}`);
      return null;
    }
  }
}

