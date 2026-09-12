import { FunctionCallResult, isNaturalLanguageRequest, ToolHandler } from '../../tool.type';
import { ChatContext } from '../../../../chat/chat-context';
import { LightingAgent } from '../../../agent/lighting/lighting.agent';
import { AgentToolsDefinition } from '../../definition/agent-tools.definition';
import { getErrorMessage } from '../../../../../utils/error.utils';

/** The chat's door to the lighting designer. Same shape as the disc jockey handlers. */
export class LightingDesignerHandler implements ToolHandler {
  readonly name = AgentToolsDefinition.lightingDesigner.name;

  constructor(private readonly lightingAgent: LightingAgent) {}

  async execute(args: unknown, ctx?: ChatContext): Promise<FunctionCallResult> {
    if (!isNaturalLanguageRequest(args)) {
      return {
        message: `Invalid arguments provided to ${this.name}. Expected parameter natural_language_request to be a string.`,
        name: this.name,
        type: 'string',
      };
    }

    try {
      const result = await this.lightingAgent.design(args.natural_language_request, ctx);

      return {
        message: result.text || 'The lighting designer changed the lights but had nothing to add.',
        name: this.name,
        type: 'string',
      };
    } catch (error) {
      return {
        message: `The lighting designer could not act: ${getErrorMessage(error)}`,
        name: this.name,
        type: 'string',
      };
    }
  }
}
