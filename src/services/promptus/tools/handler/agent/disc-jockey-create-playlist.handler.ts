import { FunctionCallResult, isNaturalLanguageRequest, ToolHandler } from '../../tool.type';
import { DiscJockeyAgent } from '../../../agent/disc-jockey/disc-jockey.agent';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';
import { getErrorMessage } from '../../../../../utils/error.utils';

export class DiscJockeyCreatePlaylistHandler implements ToolHandler {
  readonly name = AgentToolsDefinition.discJockeyCreatePlaylist.name;

  constructor(private readonly djAgent: DiscJockeyAgent) {}

  async execute(args: unknown, sessionId?: string): Promise<FunctionCallResult> {
    if (!isNaturalLanguageRequest(args)) {
      return {
        message: `Invalid arguments provided to ${this.name}. Expected parameter natural_language_request to be a string.`,
        name: this.name,
        type: 'string',
      };
    }

    try {
      const cacheEntry = await this.djAgent.createPlaylist(args.natural_language_request, sessionId);

      return {
        description: 'Songs returned from Disc Jockey agent',
        cache: cacheEntry,
        type: 'playlist',
      };
    } catch (error) {
      console.error('Error executing query:', error);
      return {
        message: `Error executing query: ${getErrorMessage(error)}`,
        name: this.name,
        type: 'string',
      };
    }
  }
}
