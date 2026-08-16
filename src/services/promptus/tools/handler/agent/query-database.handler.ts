import { FunctionCallResult, isNaturalLanguageRequest, ToolHandler } from '../../tool.type';
import { QueryDatabaseAgent } from '../../../agent/query-database/query-database.agent';
import { MusicSearchResult, PlaySource } from '../../../agent/disc-jockey/disc-jockey.agent';
import { JSONPath } from 'jsonpath-plus';
import { MusicDbAggregateResult } from '../../../../music-db/music-db.service';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';
import { Logger } from '@nestjs/common';
import { getErrorMessage } from '../../../../../utils/error.utils';
import { isSourceActive } from '../../../../../config/active-source.util';



const MusicResultExpected: MusicSearchResult = {
  id: 'string',
  source: [] as PlaySource[],
  title: 'string',
  artist: 'string',
  album: 'string',
};

const validMusicSearchResultKeys: (keyof MusicSearchResult)[] = ['id', 'source', 'title', 'artist', 'album'];

export class QueryDatabaseHandler implements ToolHandler {
  private readonly logger = new Logger('QueryDatabaseHandler');
  readonly name = AgentToolsDefinition.searchMusicDatabase.name;

  constructor(private readonly queryDatabaseAgent: QueryDatabaseAgent) {}

  private extractProperty(jsonPath: string | null, song: MusicDbAggregateResult): string {
    if (!jsonPath) return '';
    const property = JSONPath({ path: jsonPath, json: song, ignoreEvalErrors: false });
    return Array.isArray(property) ? property[0] : property;
  }

  private extractSourceProperty(jsonPath: string | null, song: MusicDbAggregateResult): PlaySource[] {
    if (!jsonPath) return [];
    const property = JSONPath({ path: jsonPath, json: song, ignoreEvalErrors: false }) as unknown;
    const castedProperty = Array.isArray(property) ? property[0] : property;

    if (!Array.isArray(castedProperty)) {
      throw new Error('Invalid source property');
    }

    const playable = ['qobuz', 'file', 'spotify'];
    let sources: PlaySource[] = [];
    for (const src of castedProperty) {
      if (typeof src !== 'object' || src === null || typeof src.sourceId !== 'string' || !playable.includes(src.name)) {
        this.logger.warn(`Source ${JSON.stringify(src)} is not supported. Skipping.`);
        continue;
      }
      // Whatever the model queried, a source whose subscription is inactive must never
      // make it back into a playlist.
      if (!isSourceActive(src.name)) {
        this.logger.debug(`Source ${src.name} is not active. Skipping.`);
        continue;
      }
      sources.push(src as PlaySource);
    }

    return sources;

  }

  private castWithProbableStructure(dbResult: MusicDbAggregateResult[]): MusicSearchResult[] {
    const musicSearchResults: MusicSearchResult[] = [];

    if (dbResult.length > 0) {
      const candidateJSON = {
        source: '$.source',
        id: '$._id',
        albumName: '$.AlbumName',
        artistName: '$.ArtistName',
        title: '$.title',
        trackNumber: '$.track_number',
        discNumber: '$.disc_number',
      };

      for (const rawSong of dbResult) {
        const song: MusicSearchResult = {
          id: this.extractProperty(candidateJSON.id, rawSong),
          source: this.extractSourceProperty(candidateJSON.source, rawSong),
          title: this.extractProperty(candidateJSON.title, rawSong),
          artist: this.extractProperty(candidateJSON.artistName, rawSong),
          album: this.extractProperty(candidateJSON.albumName, rawSong),
        };

        // A missing id means the assumed structure was wrong - throw so the caller retries with
        // the agentic cast. An empty source array does not: it is the expected outcome for a song
        // whose only sources are inactive, and re-casting it would not bring them back.
        if (song.id === undefined || song.source === undefined || !Array.isArray(song.source)) {
          throw new Error('Invalid casting');
        }

        if (song.source.length === 0) {
          this.logger.debug(`Song ${song.id} has no active source. Skipping.`);
          continue;
        }

        musicSearchResults.push(song);
      }
    }

    return musicSearchResults;
  }

  private async castWithAgenticModel(dbResult: MusicDbAggregateResult[]): Promise<MusicSearchResult[]> {
    const musicSearchResults: MusicSearchResult[] = [];

    if (dbResult.length > 0) {
      const jsonPathResponse = await this.queryDatabaseAgent.getJSONPath({
        sourceObject: dbResult[0],
        targetProperties: Object.keys(MusicResultExpected).filter((key) => this.isMusicSearchResultKey(key)),
      });

      if (!jsonPathResponse.isValid()) {
        throw new Error('Invalid JSON Path Response');
      }

      for (const rawSong of dbResult) {
        const song: MusicSearchResult = {
          id: this.extractProperty(jsonPathResponse.mapping.id, rawSong),
          source: this.extractSourceProperty(jsonPathResponse.mapping.source, rawSong),
          title: this.extractProperty(jsonPathResponse.mapping.title, rawSong),
          artist: this.extractProperty(jsonPathResponse.mapping.artistName, rawSong),
          album: this.extractProperty(jsonPathResponse.mapping.albumName, rawSong),
        };
        if (song.source.length === 0) {
          this.logger.debug(`Song ${song.id} has no active source. Skipping.`);
          continue;
        }
        musicSearchResults.push(song);
      }
    }
    return musicSearchResults;
  }

  private isMusicSearchResultKey(key: string): key is keyof MusicSearchResult {
    // We have to cast validMusicKeys to string[] for the .includes() check to work smoothly
    return (validMusicSearchResultKeys as string[]).includes(key);
  }

  async execute(args: unknown, sessionId?: string): Promise<FunctionCallResult> {
    if (!isNaturalLanguageRequest(args)) {
      return {
        message: `Invalid arguments provided to ${this.name}. Expected parameter natural_language_request to be a string.`,
        name: this.name,
        type: 'string',
      };
    }

    try {
      const dbResult = await this.queryDatabaseAgent.generateQuery(args.natural_language_request, sessionId);
      let musicSearchResults: MusicSearchResult[] = [];
      try {
        musicSearchResults = this.castWithProbableStructure(dbResult);
      } catch (e) {
        this.logger.error('Casting with assumed returned structure failed. Trying with agentic model.');
        musicSearchResults = await this.castWithAgenticModel(dbResult);
      }

      return {
        message: JSON.stringify(musicSearchResults),
        name: this.name,
        type: 'string',
      };
    } catch (error) {
      return {
        message: `Error executing query: ${getErrorMessage(error)}`,
        name: this.name,
        type: 'string',
      };
    }
  }
}
