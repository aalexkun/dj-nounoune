import { SearchPromptusRequest } from '../request/search.promptus.request';
import { GetSourceIdPromptusRequest } from '../request/get-source-id.promptus.request';
import { PromptusService } from '../promptus.service';
import { MusicDbAggregateResult, MusicDbService } from '../../../music-db/music-db.service';
import { JSONPath } from 'jsonpath-plus';
import { AddMpdRequest } from '../../../mpd-client/requests/AddMpdRequest';

export type MusicSearchResult = {
  id: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string;
};

export class MusicSearchHandler {
  constructor(
    private promptusService: PromptusService,
    private musicDbService: MusicDbService,
  ) {}

  async search(query: string): Promise<MusicSearchResult[]> {
    let results: MusicSearchResult[] = [];

    // Check RAG for previous query / response

    const response = await this.promptusService.generate(new SearchPromptusRequest(query));

    // RAG - Saves the query / response in the database

    if (!Array.isArray(response) && response?.parsed?.function === 'aggregate') {
      const dbResults = await this.musicDbService.aggregate(response.parsed.collection, response.parsed.params);
      results = await this.parseResults(dbResults);
    }

    // trim arrau for 200 songs max

    return results.length > 300 ? results.slice(0, 300) : results;
  }

  private extractProperty(jsonPath: string | null, song: MusicDbAggregateResult): string {
    if (!jsonPath) return '';
    const property = JSONPath({ path: jsonPath, json: song });
    return Array.isArray(property) ? property[0] : property;
  }

  private async parseResults(dbResult: MusicDbAggregateResult[]): Promise<MusicSearchResult[]> {
    const musicSearchResults: MusicSearchResult[] = [];
    if (dbResult.length > 0) {
      const jsonPathMapping = await this.promptusService.generate(new GetSourceIdPromptusRequest(JSON.stringify(dbResult[0])));

      for (const song of dbResult) {
        const parsedSong: MusicSearchResult = {
          album: this.extractProperty(jsonPathMapping.mapping.albumName, song),
          artist: this.extractProperty(jsonPathMapping.mapping.artistName, song),
          id: this.extractProperty(jsonPathMapping.mapping.id, song),
          sourceId: this.extractProperty(jsonPathMapping.mapping.sourceId, song),
          title: this.extractProperty(jsonPathMapping.mapping.title, song),
        };
        musicSearchResults.push(parsedSong);
      }
      return musicSearchResults;
    }
    return musicSearchResults;
  }
}
