import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { DiscJockeyAgent } from '../../../agent/disc-jockey/disc-jockey.agent';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';

export class DiscJockeyCreatePlaylistHandler implements ToolHandler {
  readonly name = AgentToolsDefinition.discJockeyCreatePlaylist.name;

  constructor(private readonly djAgent: DiscJockeyAgent) {}

  async execute(args: any): Promise<FunctionCallResult> {
    const query = args.natural_language_request;
    if (!query) {
      return {
        message: 'No natural_language_request provided.',
        name: this.name,
      };
    }

    try {
      const djResult = await this.djAgent.createPlaylist(query);

      return {
        message: JSON.stringify({
          functionResponses: [
            {
              name: this.name,
              response: {
                results: djResult,
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
