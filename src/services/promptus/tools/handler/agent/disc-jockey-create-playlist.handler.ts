import { FunctionCallResult, isNaturalLanguageRequest, ToolHandler } from '../../tool.type';
import { ChatContext } from '../../../../chat/chat-context';
import { DiscJockeyAgent } from '../../../agent/disc-jockey/disc-jockey.agent';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';
import { getErrorMessage } from '../../../../../utils/error.utils';

export class DiscJockeyCreatePlaylistHandler implements ToolHandler {
  readonly name = AgentToolsDefinition.discJockeyCreatePlaylist.name;

  constructor(private readonly djAgent: DiscJockeyAgent) {}

  async execute(args: unknown, ctx?: ChatContext): Promise<FunctionCallResult> {
    if (!isNaturalLanguageRequest(args)) {
      return {
        message: `Invalid arguments provided to ${this.name}. Expected parameter natural_language_request to be a string.`,
        name: this.name,
        type: 'string',
      };
    }

    try {
      const created = await this.djAgent.createPlaylist(args.natural_language_request, ctx);

      return {
        description: 'Songs returned from Disc Jockey agent',
        cache: created.cacheKey,
        type: 'playlist',
        // Carried so `play_music` can bind the queue it builds back to the message the user is
        // looking at, and the queue watcher can then keep that message in step with MPD.
        messageId: created.messageId,
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
