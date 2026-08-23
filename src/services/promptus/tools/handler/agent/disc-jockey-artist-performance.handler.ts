import { FunctionCallResult, isNaturalLanguageRequest, ToolHandler } from '../../tool.type';
import { DiscJockeyAgent } from '../../../agent/disc-jockey/disc-jockey.agent';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';
import { getErrorMessage } from '../../../../../utils/error.utils';

export class DiscJockeyArtistPerformanceHandler implements ToolHandler {
  readonly name = AgentToolsDefinition.discJockeyArtistPerformance.name;

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
      const djResult = await this.djAgent.findUpcomingPerformances(args.natural_language_request, sessionId);

      return {
        message: djResult.text || 'The tour date search came back empty.',
        name: this.name,
        type: 'string',
      };
    } catch (error) {
      return {
        message: `Error searching for upcoming performances: ${getErrorMessage(error)}`,
        name: this.name,
        type: 'string',
      };
    }
  }
}
