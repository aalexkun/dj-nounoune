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
  MlAgentSearchResponseSchema,
  MlAgentRegisterResponseSchema,
  OpenSearchSearchResponseSchema,
  OpenSearchSearchResponse,
  OpenSearchArtistSearchResponse,
  OpenSearchArtistSearchResponseSchema,
  OpenSearchAlbumSearchResponse,
  OpenSearchAlbumSearchResponseSchema,
} from './types';
import { SearchDeduplicationSongQuery } from './search-deduplication-song.query';
import { DuplicateCandidateCriteria, SearchDuplicateCandidatesQuery } from './search-duplicate-candidates.query';
import { SearchSongQuery } from './search-song.query';
import { ArtistSearchQuery } from './search-artist.query';
import { AlbumSearchQuery } from './search-album.query';
import { generateDynamicMappings } from './dynamic-mapping.util';
import { SongSchema } from '../../schemas/song.schema';
import { ArtistSchema } from '../../schemas/artist.schema';
import { AlbumSchema } from '../../schemas/albums.schema';
import { SearchFuzzyQuery } from './search-fuzzy.query';
import { SearchSemanticQuery } from './search-semantic.query';
import { getActiveSourceTypes } from '../../config/active-source.util';
import { getErrorMessage } from '../../utils/error.utils';

export type DuplicateSongCheck = {
  songId: string;
  track_number: number;
  disc_number: number;
  year: string;
  title: string;
  artist: string;
  album: string;
};

@Injectable()
export class OpensearchService {
  private readonly logger = new Logger(OpensearchService.name);
  private readonly client: Client | null = null;
  private modelId: string | null = null;

  public getClient(): Client | null {
    return this.client;
  }

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
      await this.client.transport.request({
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
                // No `ignore_missing` here: the deployed neural-search plugin rejects the parameter
                // (parse_exception on pipeline PUT), and does not need it - a field_map source that
                // is absent from the document is skipped and the document passes through with no
                // vector. What the processor does reject is an *empty string*, which is why
                // buildSongDocument omits song_semantic rather than writing ''.
              },
            },
          ],
          // Belt and braces for anything the processor does throw on: keep the document and leave a
          // note of why the vector is missing. Must not be an empty array - the API rejects that.
          on_failure: [
            {
              set: {
                field: 'embedding_error',
                value: '{{ _ingest.on_failure_message }}',
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
      const exists = existsResponse.body;

      if (exists) {
        this.logger.warn('Index "songs" already exists. Prune it first to recreate.');
        return false;
      }

      this.logger.log('Creating index "songs" with k-NN settings...');

      const dynamicMappings = generateDynamicMappings(SongIndices.mappings, [
        { prefix: '', schema: SongSchema },
        { prefix: 'artist_info', schema: ArtistSchema },
        { prefix: 'album_info', schema: AlbumSchema },
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

      // 6. Register Data Distribution Agent
      this.logger.log('Checking for existing DataDistributionTool agent "song_data_distribution_agent"...');
      let agentId: string | null = null;
      try {
        let agentSearchRes: { body: unknown } | undefined;
        try {
          agentSearchRes = await this.client.transport.request({
            method: 'POST',
            path: '/_plugins/_ml/agents/_search',
            body: {
              size: 1000,
              query: {
                term: {
                  'name.keyword': 'song_data_distribution_agent',
                },
              },
            },
          });
        } catch (searchError) {
          const err = searchError as Error & { meta?: { statusCode?: number } };
          if (err.meta?.statusCode === 404 || err.message.includes('index_not_found_exception')) {
            this.logger.log('ML agent index not found. Assuming agent does not exist.');
          } else {
            throw searchError;
          }
        }

        if (agentSearchRes) {
          const parsedAgentSearch = MlAgentSearchResponseSchema.safeParse(agentSearchRes.body);
          if (parsedAgentSearch.success && parsedAgentSearch.data.hits.hits.length > 0) {
            agentId = parsedAgentSearch.data.hits.hits[0]._id;
            this.logger.log(`Using existing DataDistributionTool agent: ${agentId}`);
          }
        }

        if (!agentId) {
          this.logger.log('Agent not found. Registering "song_data_distribution_agent"...');
          const registerAgentRes = await this.client.transport.request({
            method: 'POST',
            path: '/_plugins/_ml/agents/_register',
            body: {
              name: 'song_data_distribution_agent',
              type: 'flow',
              description: 'Agent for the DataDistributionTool for songs index',
              tools: [
                {
                  type: 'DataDistributionTool',
                  parameters: {},
                },
              ],
            },
          });

          const parsedRegisterAgent = MlAgentRegisterResponseSchema.safeParse(registerAgentRes.body);
          if (!parsedRegisterAgent.success) {
            this.logger.error('Failed to register agent: schema mismatch', parsedRegisterAgent.error);
          } else {
            agentId = parsedRegisterAgent.data.agent_id;
            this.logger.log(`Registered new DataDistributionTool agent: ${agentId}`);
          }
        }
      } catch (agentError) {
        const err = agentError as Error;
        this.logger.error(`Failed to handle agent registration: ${err.message}`);
      }

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
      const exists = existsResponse.body;

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

      // Delete DataDistributionTool agent if found
      this.logger.log('Searching for DataDistributionTool agent to delete...');
      try {
        let agentSearchRes: { body: unknown } | undefined;
        try {
          agentSearchRes = await this.client.transport.request({
            method: 'POST',
            path: '/_plugins/_ml/agents/_search',
            body: {
              size: 1000,
              query: {
                term: {
                  'name.keyword': 'song_data_distribution_agent',
                },
              },
            },
          });
        } catch (searchError) {
          const err = searchError as Error & { meta?: { statusCode?: number } };
          if (err.meta?.statusCode === 404 || err.message.includes('index_not_found_exception')) {
            this.logger.log('ML agent index not found. Nothing to delete.');
          } else {
            throw searchError;
          }
        }

        if (agentSearchRes) {
          const parsedAgentSearch = MlAgentSearchResponseSchema.safeParse(agentSearchRes.body);
          if (parsedAgentSearch.success && parsedAgentSearch.data.hits.hits.length > 0) {
            const agentId = parsedAgentSearch.data.hits.hits[0]._id;
            await this.client.transport.request({
              method: 'DELETE',
              path: `/_plugins/_ml/agents/${agentId}`,
            });
            this.logger.log(`Agent ${agentId} deleted successfully.`);
          }
        }
      } catch (agentErr) {
        const err = agentErr as Error;
        this.logger.warn(`Failed to delete agent: ${err.message}`);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed during prune index: ${err.message}`, err.stack);
    }
  }

  /**
   * The document as written to the `songs` index. One builder for both the bulk and the
   * single-song path, so they cannot drift.
   *
   * `song_semantic` is what the ingest pipeline embeds into `song_vector`, and it carries the
   * lyric distillation alone - identity is matched lexically on title/artist/album. It is omitted
   * rather than emptied when a song has no distillation yet: an empty string still embeds, to a
   * vector that means nothing and would sit in every kNN result.
   */
  private buildSongDocument(song: PopulatedSong): Record<string, unknown> {
    // A hydrated document is flattened first; a song that came out of an aggregate is already plain.
    const songObj: Record<string, unknown> = { ...(typeof song.toObject === 'function' ? song.toObject() : song) };
    const lyric = typeof songObj.lyric_semantic === 'string' ? songObj.lyric_semantic.trim() : '';

    return {
      ...songObj,
      // Indexed as song_semantic below; not stored a second time under its Mongo name.
      lyric_semantic: undefined,
      artist: song.artist.artist || '',
      album: song.album.title || '',
      artist_info: songObj.artist,
      album_info: songObj.album,
      artist_id: song.artist._id.toString() || '',
      album_id: song.album._id.toString() || '',
      ...(lyric ? { song_semantic: lyric } : {}),
    };
  }

  /**
   * Index one song through the ingest pipeline - a full `index`, never an `_update`, because only
   * the former runs the pipeline that re-embeds `song_vector`. Never throws: the song is in Mongo
   * either way, and callers log and move on.
   */
  async indexSong(song: PopulatedSong): Promise<void> {
    if (!this.client) {
      this.logger.error('OpenSearch client is not initialized');
      return;
    }

    try {
      await this.client.index({
        index: SongIndices.name,
        id: song._id.toString(),
        body: this.buildSongDocument(song),
      });
    } catch (error) {
      this.logger.error(`Failed to index song ${song._id.toString()}: ${getErrorMessage(error)}`);
    }
  }

  async indexSongs(songs: PopulatedSong[]): Promise<void> {
    if (!this.client) {
      this.logger.error('OpenSearch client is not initialized');
      return;
    }

    for (const song of songs) {
      await this.indexSong(song);
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

    // Purely lexical: identity is matched on the analysed title/artist/album fields, never on the
    // vector, so this works on a cluster with no ML model deployed at all.
    const query = new SearchDeduplicationSongQuery(songAttributes);

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

  /**
   * Recall for deduplication: everything that might be the same recording, loosely matched on
   * title and artist. Nothing here is a verdict — see `SearchDuplicateCandidatesQuery`.
   */
  async findDuplicateCandidates(criteria: DuplicateCandidateCriteria): Promise<OpenSearchSearchResponse | null> {
    if (!this.client) return null;

    const query = new SearchDuplicateCandidatesQuery(criteria);

    try {
      const response = await this.client.search({
        index: 'songs',
        body: query.getQuery(),
      });

      const parsedResponse = OpenSearchSearchResponseSchema.safeParse(response.body);

      if (parsedResponse.success) {
        return parsedResponse.data;
      }

      this.logger.error('OpenSearch duplicate candidate response validation failed', parsedResponse.error);
      return null;
    } catch (error) {
      // Rethrown rather than swallowed, unlike the other searches here: a recall that fails is
      // not "no duplicates", and the dedup run has to count it as an error instead of quietly
      // moving on while the cluster logs a stack trace.
      throw new Error(`Error querying OpenSearch for duplicate candidates: ${getErrorMessage(error)}`);
    }
  }

  async fuzzySearch(keywords: string[], limit = 200): Promise<OpenSearchSearchResponse | null> {
    if (!this.client) return null;

    // This search and searchBySemantic are the two on the agentic path, so both filter to the
    // active sources. The dedup and importer searches below stay unfiltered on purpose - they
    // must keep seeing every row in the index.
    const query = new SearchFuzzyQuery(keywords, limit, getActiveSourceTypes());

    try {
      const response = await this.client.search({
        index: 'songs',
        body: query.getQuery(),
      });

      const parsedResponse = OpenSearchSearchResponseSchema.safeParse(response.body);

      if (parsedResponse.success) {
        return parsedResponse.data;
      } else {
        this.logger.error('OpenSearch song search response validation failed', parsedResponse.error);
        return null;
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error querying OpenSearch Song Search: ${err.message}`);
      return null;
    }
  }

  /**
   * What the library holds that is *about* the same thing as `normalisedQuery` - a sentence in the
   * same register as the stored lyric distillations, produced by the query generator. Pure kNN on
   * `song_vector`; a song not yet enriched has no vector and simply never matches.
   */
  async searchBySemantic(normalisedQuery: string, limit = 20): Promise<OpenSearchSearchResponse | null> {
    if (!this.client) return null;

    const modelId = await this.getDeployedModelId();
    if (!modelId) {
      this.logger.warn('Cannot run semantic search: no deployed model found.');
      return null;
    }

    const query = new SearchSemanticQuery(normalisedQuery, modelId, limit, getActiveSourceTypes());

    try {
      const response = await this.client.search({
        index: SongIndices.name,
        body: query.getQuery(),
      });

      const parsedResponse = OpenSearchSearchResponseSchema.safeParse(response.body);

      if (parsedResponse.success) {
        return parsedResponse.data;
      }

      this.logger.error('OpenSearch semantic search response validation failed', parsedResponse.error);
      return null;
    } catch (error) {
      this.logger.error(`Error querying OpenSearch semantic search: ${getErrorMessage(error)}`);
      return null;
    }
  }

  async fuzzySearchSong(
    title: string,
    album: string,
    artist: string,
    albumId?: string | null,
    artistId?: string | null,
  ): Promise<OpenSearchSearchResponse | null> {
    if (!this.client) return null;

    const query = new SearchSongQuery(title, album, artist, albumId, artistId);

    try {
      const response = await this.client.search({
        index: 'songs',
        body: query.getQuery(),
      });

      const parsedResponse = OpenSearchSearchResponseSchema.safeParse(response.body);

      if (parsedResponse.success) {
        return parsedResponse.data;
      } else {
        this.logger.error('OpenSearch song search response validation failed', parsedResponse.error);
        return null;
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error querying OpenSearch Song Search: ${err.message}`);
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
