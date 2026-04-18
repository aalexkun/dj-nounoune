import { FunctionCallResult, isNaturalLanguageRequest, ToolHandler } from '../../tool.type';
import { QueryDatabaseAgent } from '../../../agent/query-database/query-database.agent';
import { MusicSearchResult } from '../../../agent/disc-jockey/disc-jockey.agent';
import { JSONPath } from 'jsonpath-plus';
import { MusicDbAggregateResult } from '../../../../music-db/music-db.service';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';
import { Logger } from '@nestjs/common';

const MusicResultExpected: MusicSearchResult = {
  id: 'string',
  sourceId: 'string',
  title: 'string',
  artist: 'string',
  album: 'string',
};

const validMusicSearchResultKeys: (keyof MusicSearchResult)[] = ['id', 'sourceId', 'title', 'artist', 'album'];

export class QueryDatabaseHandler implements ToolHandler {
  private readonly logger = new Logger('QueryDatabaseHandler');
  readonly name = AgentToolsDefinition.searchMusicDatabase.name;

  constructor(private readonly queryDatabaseAgent: QueryDatabaseAgent) {}

  private extractProperty(jsonPath: string | null, song: MusicDbAggregateResult): string {
    if (!jsonPath) return '';
    const property = JSONPath({ path: jsonPath, json: song, ignoreEvalErrors: false });
    return Array.isArray(property) ? property[0] : property;
  }

  private castWithProbableStructure(dbResult: MusicDbAggregateResult[]): MusicSearchResult[] {
    const musicSearchResults: MusicSearchResult[] = [];

    if (dbResult.length > 0) {
      const candidateJSON = {
        sourceId: '$.source[0].sourceId',
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
          sourceId: this.extractProperty(candidateJSON.sourceId, rawSong),
          title: this.extractProperty(candidateJSON.title, rawSong),
          artist: this.extractProperty(candidateJSON.artistName, rawSong),
          album: this.extractProperty(candidateJSON.albumName, rawSong),
        };

        if (song.id === undefined || song.sourceId === undefined) {
          throw new Error('Invalid casting');
        } else {
          musicSearchResults.push(song);
        }
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
          sourceId: this.extractProperty(jsonPathResponse.mapping.sourceId, rawSong),
          title: this.extractProperty(jsonPathResponse.mapping.title, rawSong),
          artist: this.extractProperty(jsonPathResponse.mapping.artistName, rawSong),
          album: this.extractProperty(jsonPathResponse.mapping.albumName, rawSong),
        };
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
        message: `Error executing query: ${error.message}`,
        name: this.name,
        type: 'string',
      };
    }
  }
}
