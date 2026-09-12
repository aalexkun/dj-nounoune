import { z } from 'zod';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { HueToolsDefinition } from '../../definition/hue-tools.definition';
import { DomoticService } from '../../../../domotic/domotic.service';
import { LightingSceneService } from '../../../../domotic/lighting-scene.service';
import { renderLightingResult } from '../../../agent/lighting/lighting-brief.util';
import { getErrorMessage } from '../../../../../utils/error.utils';

const ArgsSchema = z.object({ title: z.string().min(1) });

export class ApplySceneHandler implements ToolHandler {
  readonly name = HueToolsDefinition.applyScene.name;

  constructor(
    private readonly domoticService: DomoticService,
    private readonly sceneService: LightingSceneService,
  ) {}

  async execute(args: unknown): Promise<FunctionCallResult> {
    const parsed = ArgsSchema.safeParse(args);

    if (!parsed.success) {
      return { message: `Invalid arguments for ${this.name}: ${parsed.error.message}. Expected { title }.`, name: this.name, type: 'string' };
    }

    try {
      const scene = await this.sceneService.get(parsed.data.title);

      if (!scene) {
        const known = (await this.sceneService.list()).map((entry) => `"${entry.title}"`).join(', ');
        return {
          message: `No saved scene is called "${parsed.data.title}". Saved scenes: ${known || 'none'}. Compose the lighting with hue_apply_lighting instead.`,
          name: this.name,
          type: 'string',
        };
      }

      const result = await this.domoticService.applyById(LightingSceneService.toUpdates(scene));

      return { message: `scene "${scene.title}"\n${renderLightingResult(result)}`, name: this.name, type: 'string' };
    } catch (error) {
      return { message: `Could not apply the scene: ${getErrorMessage(error)}`, name: this.name, type: 'string' };
    }
  }
}
