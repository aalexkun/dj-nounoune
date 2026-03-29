import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { DiscJockeyAgent } from '../../../agent/disc-jockey/disc-jockey.agent';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';

export class DiscJockeyWhatIsPlayingHandler implements ToolHandler {
  readonly name = AgentToolsDefinition.discJockeyWhatIsPlaying.name;

  constructor(private readonly djAgent: DiscJockeyAgent) {}

  async execute(args: any): Promise<FunctionCallResult> {
    const request = args.request;
    if (!request) {
      return {
        message: 'No request provided.',
        name: this.name,
      };
    }

    try {
      const djResult = this.djAgent.whatIsPlaying(request);

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
