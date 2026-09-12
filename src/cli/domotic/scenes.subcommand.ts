import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { DomoticService } from '../../services/domotic/domotic.service';
import { LightingSceneService } from '../../services/domotic/lighting-scene.service';
import { describeHueUpdate } from '../../services/promptus/agent/lighting/lighting-brief.util';
import { getErrorMessage } from '../../utils/error.utils';

interface ScenesOptions {
  apply?: string;
  delete?: string;
  dryRun?: boolean;
}

@SubCommand({
  name: 'scenes',
  description: 'List the saved lighting scenes; --apply <title> replays one, --delete <title> removes one',
})
@Injectable()
export class DomoticScenesSubCommand extends CommandRunner {
  private readonly logger = new Logger(DomoticScenesSubCommand.name);

  constructor(
    private readonly domoticService: DomoticService,
    private readonly sceneService: LightingSceneService,
  ) {
    super();
  }

  async run(inputs: string[], options: ScenesOptions): Promise<void> {
    try {
      if (options.delete) {
        const removed = await this.sceneService.remove(options.delete);
        this.logger.log(removed ? `Deleted scene "${options.delete}".` : `No scene is called "${options.delete}".`);
        return;
      }

      if (options.apply) {
        await this.apply(options.apply, options.dryRun ?? false);
        return;
      }

      const scenes = await this.sceneService.list();

      if (scenes.length === 0) {
        this.logger.log('No scene saved yet. Ask the designer to "save this as <name>".');
        return;
      }

      for (const scene of scenes) {
        console.log(`${scene.title}${scene.room ? ` (${scene.room})` : ''}${scene.description ? ` — ${scene.description}` : ''}`);
        for (const state of scene.states) {
          console.log(`  ${state.label ?? state.lightId}: ${describeState(state)}`);
        }
      }
    } catch (error) {
      this.logger.error(`Scene command failed: ${getErrorMessage(error)}`);
    }
  }

  private async apply(title: string, dryRun: boolean): Promise<void> {
    const scene = await this.sceneService.get(title);

    if (!scene) {
      this.logger.error(`No scene is called "${title}".`);
      return;
    }

    const result = await this.domoticService.applyById(LightingSceneService.toUpdates(scene), dryRun);

    for (const entry of result.applied) {
      console.log(`  ${dryRun ? 'would set' : 'set'}  ${entry.light.name}: ${describeHueUpdate(entry.update)}`);
    }

    for (const failure of result.failed) {
      console.log(`  failed   ${failure.target}: ${failure.reason}`);
    }

    this.logger.log(
      `Scene "${scene.title}": ${result.applied.length} light(s)${result.failed.length > 0 ? `, ${result.failed.length} failed` : ''}${dryRun ? ' (dry run)' : ''}.`,
    );
  }

  @Option({ flags: '-a, --apply <title>', description: 'Replay a saved scene on the lights' })
  parseApply(val: string): string {
    return val;
  }

  @Option({ flags: '--delete <title>', description: 'Delete a saved scene' })
  parseDelete(val: string): string {
    return val;
  }

  @Option({ flags: '-d, --dry-run', description: 'With --apply, resolve without writing', defaultValue: false })
  parseDryRun(): boolean {
    return true;
  }
}

function describeState(state: { on?: boolean; brightness?: number; colorX?: number; colorY?: number; mirek?: number; effect?: string }): string {
  return describeHueUpdate({
    on: state.on,
    brightness: state.brightness,
    colorXy: state.colorX !== undefined && state.colorY !== undefined ? { x: state.colorX, y: state.colorY } : undefined,
    mirek: state.mirek,
    effect: undefined,
  }).concat(state.effect ? `, effect ${state.effect}` : '');
}
