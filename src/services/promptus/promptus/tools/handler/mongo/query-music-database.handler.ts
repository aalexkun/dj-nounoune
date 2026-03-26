import { Logger } from '@nestjs/common';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { MusicSearchHandler } from '../../../handler/music-search.handler';

type QueryMusicDatabaseArgs = {
  natural_language_request: string;
};

export class QueryMusicDatabaseHandler implements ToolHandler {
  readonly name = 'query_music_database';
  private readonly logger = new Logger('QueryMusicDatabaseHandler');

  constructor(private readonly musicSearchHandler: MusicSearchHandler) {}

  private isQueryMusicDatabaseArgs(args: unknown): args is QueryMusicDatabaseArgs {
    if (!args || typeof args !== 'object') {
      return false;
    }
    const record = args as Record<string, unknown>;
    return typeof record.natural_language_request === 'string';
  }

  async execute(args: unknown): Promise<FunctionCallResult> {
    if (!this.isQueryMusicDatabaseArgs(args)) {
      const err = `Invalid arguments provided to ${this.name}. Expected an object with natural_language_request property of type string.`;
      this.logger.error(err);
      return {
        message: err,
        name: this.name,
      };
    }

    try {
      const musicSearchResult = await this.musicSearchHandler.search(args.natural_language_request);
      return {
        message: JSON.stringify({
          functionResponses: [
            {
              name: this.name,
              response: {
                results: musicSearchResult,
              },
            },
          ],
        }),
        name: this.name,
      };
    } catch (e: any) {
      const msg = 'Function call failed with error: ' + e.message;
      this.logger.error(msg);
      return {
        message: msg,
        name: this.name,
      };
    }
  }
}
