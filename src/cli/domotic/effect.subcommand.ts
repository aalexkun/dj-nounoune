import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { DomoticService } from '../../services/domotic/domotic.service';
import { HUE_EFFECTS, isHueEffect } from '../../services/domotic/hue.interfaces';
import { getErrorMessage } from '../../utils/error.utils';

interface EffectOptions {
  room?: string;
  dryRun?: boolean;
}

/**
 * `domotic effect <effect> [light...]`
 *
 * The first argument is the effect, the rest name the lights: a legend label from the placement
 * files, the bridge's own name, or an id. No light named means every light, or every light of
 * `--room` when one is given. `no_effect` is how a running effect is stopped.
 */
@SubCommand({
  name: 'effect',
  description: `Run an effect on some lights, or stop one with no_effect. Effects: ${HUE_EFFECTS.join(', ')}`,
  argsDescription: {
    effect: `One of ${HUE_EFFECTS.join(', ')}`,
    light: 'Lights to target, by placement label, bridge name or id. Omit for every light (of --room when given).',
  },
  arguments: '<effect> [light...]',
})
@Injectable()
export class DomoticEffectSubCommand extends CommandRunner {
  private readonly logger = new Logger(DomoticEffectSubCommand.name);

  constructor(private readonly domoticService: DomoticService) {
    super();
  }

  async run(inputs: string[], options: EffectOptions): Promise<void> {
    const [effect, ...lights] = inputs.map((input) => input.trim());

    if (!effect) {
      this.logger.error(`Give an effect: ${HUE_EFFECTS.join(', ')}.`);
      return;
    }

    if (!isHueEffect(effect)) {
      this.logger.error(`"${effect}" is not a Hue effect. Choose one of: ${HUE_EFFECTS.join(', ')}.`);
      return;
    }

    try {
      const result = await this.domoticService.applyEffect(effect, { lights, room: options.room }, options.dryRun);

      if (result.targets.length === 0) {
        this.logger.warn('No light matched the selection.');
        return;
      }

      for (const name of result.applied) {
        console.log(`  ${options.dryRun ? 'would set' : 'set'}  ${name}`);
      }

      for (const failure of result.failed) {
        console.log(`  failed   ${failure.light.name}: ${failure.reason}`);
      }

      const count = `${result.applied.length} light(s)`;
      const failed = result.failed.length > 0 ? `, ${result.failed.length} failed` : '';

      if (options.dryRun) {
        const outcome = effect === 'no_effect' ? 'the running effect would be stopped on' : `"${effect}" would be started on`;
        this.logger.warn(`Dry run: ${outcome} ${count}${failed}. Nothing was written.`);
      } else {
        const outcome = effect === 'no_effect' ? 'Stopped the effect on' : `Started "${effect}" on`;
        this.logger.log(`${outcome} ${count}${failed}.`);
      }
    } catch (error) {
      this.logger.error(`Could not apply the effect: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-r, --room <room>',
    description: 'Only the lights of one room, as named in files/hue-<room>.yaml',
  })
  parseRoom(val: string): string {
    return val;
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Show which lights would be written without talking to them',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }
}
