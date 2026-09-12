import { z } from 'zod';
import { FunctionCallResult, ToolHandler } from '../../tool.type';
import { HueToolsDefinition } from '../../definition/hue-tools.definition';
import { DomoticService } from '../../../../domotic/domotic.service';
import { LightingSceneService } from '../../../../domotic/lighting-scene.service';
import { LightingUpdatesSchema } from '../../../../domotic/lighting.interfaces';
import { describeHueUpdate } from '../../../agent/lighting/lighting-brief.util';
import { getErrorMessage } from '../../../../../utils/error.utils';

const ArgsSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  room: z.string().optional(),
  updates: LightingUpdatesSchema,
});

/**
 * Saves without applying. The states are resolved against the live lights first — the same
 * translation `hue_apply_lighting` does — so what is stored is ids and bridge units, and a
 * target that does not resolve is reported rather than stored as a name that may drift.
 */
export class SaveSceneHandler implements ToolHandler {
  readonly name = HueToolsDefinition.saveScene.name;

  constructor(
    private readonly domoticService: DomoticService,
    private readonly sceneService: LightingSceneService,
  ) {}

  async execute(args: unknown): Promise<FunctionCallResult> {
    const parsed = ArgsSchema.safeParse(args);

    if (!parsed.success) {
      return {
        message: `Invalid arguments for ${this.name}: ${parsed.error.message}. Expected { title, description?, room?, updates: [...] }.`,
        name: this.name,
        type: 'string',
      };
    }

    try {
      const { resolved, failed } = await this.domoticService.resolveLightingUpdates(parsed.data.updates, parsed.data.room);

      if (resolved.length === 0) {
        return {
          message: `Nothing to save: no entry resolved to a light. ${failed.map((entry) => `${entry.target}: ${entry.reason}`).join('; ')}`,
          name: this.name,
          type: 'string',
        };
      }

      const scene = await this.sceneService.save(
        { title: parsed.data.title, description: parsed.data.description, room: parsed.data.room, createdBy: 'agent' },
        resolved,
      );

      const lines = [
        `saved scene "${scene.title}" with ${scene.states.length} light(s)${failed.length > 0 ? `, ${failed.length} entry(ies) skipped` : ''}`,
      ];

      for (const entry of resolved) {
        lines.push(`ok|${entry.light.label ?? entry.light.name}|${describeHueUpdate(entry.update)}`);
      }

      for (const failure of failed) {
        lines.push(`skipped|${failure.target}|${failure.reason}`);
      }

      return { message: lines.join('\n'), name: this.name, type: 'string' };
    } catch (error) {
      return { message: `Could not save the scene: ${getErrorMessage(error)}`, name: this.name, type: 'string' };
    }
  }
}
