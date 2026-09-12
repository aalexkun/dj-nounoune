import { z } from 'zod';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { HueToolsDefinition } from '../../definition/hue-tools.definition';
import { DomoticService } from '../../../../domotic/domotic.service';
import { LightingUpdatesSchema } from '../../../../domotic/lighting.interfaces';
import { renderLightingResult } from '../../../agent/lighting/lighting-brief.util';
import { getErrorMessage } from '../../../../../utils/error.utils';

const ArgsSchema = z.object({
  room: z.string().optional(),
  updates: LightingUpdatesSchema,
});

/** The one lighting tool that changes the room. Everything else reads, saves or replays. */
export class ApplyLightingHandler implements ToolHandler {
  readonly name = HueToolsDefinition.applyLighting.name;

  constructor(private readonly domoticService: DomoticService) {}

  async execute(args: unknown): Promise<FunctionCallResult> {
    const parsed = ArgsSchema.safeParse(args);

    if (!parsed.success) {
      return {
        message: `Invalid arguments for ${this.name}: ${parsed.error.message}. Expected { room?, updates: [{ target, on?, brightness?, color?, kelvin?, effect?, transitionMs? }] }.`,
        name: this.name,
        type: 'string',
      };
    }

    try {
      const result = await this.domoticService.applyLighting(parsed.data.updates, parsed.data.room);

      return { message: renderLightingResult(result), name: this.name, type: 'string' };
    } catch (error) {
      return { message: `Could not reach the lights: ${getErrorMessage(error)}`, name: this.name, type: 'string' };
    }
  }
}
