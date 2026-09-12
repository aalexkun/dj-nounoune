import { z } from 'zod';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { HueToolsDefinition } from '../../definition/hue-tools.definition';
import { DomoticService } from '../../../../domotic/domotic.service';
import { renderCurrentState } from '../../../agent/lighting/lighting-brief.util';
import { getErrorMessage } from '../../../../../utils/error.utils';

const ArgsSchema = z.object({ room: z.string().optional() }).default({});

export class ReadLightsHandler implements ToolHandler {
  readonly name = HueToolsDefinition.readLights.name;

  constructor(private readonly domoticService: DomoticService) {}

  async execute(args: unknown): Promise<FunctionCallResult> {
    const parsed = ArgsSchema.safeParse(args ?? {});

    if (!parsed.success) {
      return { message: `Invalid arguments for ${this.name}: ${parsed.error.message}.`, name: this.name, type: 'string' };
    }

    try {
      const lights = await this.domoticService.resolveTargets({ room: parsed.data.room });

      return { message: renderCurrentState(lights), name: this.name, type: 'string' };
    } catch (error) {
      return { message: `Could not read the lights: ${getErrorMessage(error)}`, name: this.name, type: 'string' };
    }
  }
}
