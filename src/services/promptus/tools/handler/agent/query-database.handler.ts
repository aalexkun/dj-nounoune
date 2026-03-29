import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { QueryDatabaseAgent } from '../../../agent/query-database/query-database.agent';
import { MusicSearchResult } from '../../../agent/disc-jockey/disc-jockey.agent';
import { JSONPath } from 'jsonpath-plus';
import { MusicDbAggregateResult } from '../../../../music-db/music-db.service';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';

const MusicResultExpected: MusicSearchResult = {
  id: 'string',
  sourceId: 'string',
  title: 'string',
  artist: 'string',
  album: 'string',
};

const validMusicSearchResultKeys: (keyof MusicSearchResult)[] = ['id', 'sourceId', 'title', 'artist', 'album'];

export class QueryDatabaseHandler implements ToolHandler {
  readonly name = AgentToolsDefinition.searchMusicDatabase.name;

  constructor(private readonly queryDatabaseAgent: QueryDatabaseAgent) {}

  private extractProperty(jsonPath: string | null, song: MusicDbAggregateResult): string {
    if (!jsonPath) return '';
    const property = JSONPath({ path: jsonPath, json: song });
    return Array.isArray(property) ? property[0] : property;
  }

  private async castResult(dbResult: MusicDbAggregateResult[]): Promise<MusicSearchResult[]> {
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

  async execute(args: any): Promise<FunctionCallResult> {
    const query = args.natural_language_request;
    if (!query) {
      return {
        message: 'No natural_language_request provided.',
        name: this.name,
      };
    }

    try {
      const dbResult = await this.queryDatabaseAgent.generateQuery(query);
      const musicSearchResults = await this.castResult(dbResult);

      return {
        message: JSON.stringify({
          functionResponses: [
            {
              name: this.name,
              response: {
                results: musicSearchResults,
              },
            },
          ],
        }),
        name: this.name,
      };
    } catch (error) {
      return {
        message: `Error executing query: ${error.message}`,
        name: this.name,
      };
    }
  }
}
