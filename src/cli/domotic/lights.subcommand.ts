import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { DomoticService } from '../../services/domotic/domotic.service';
import { getErrorMessage } from '../../utils/error.utils';

interface LightsOptions {
  room?: string;
}

@SubCommand({
  name: 'lights',
  description: 'List the lights the Hue bridge knows, with their room, state and running effect',
})
@Injectable()
export class DomoticLightsSubCommand extends CommandRunner {
  private readonly logger = new Logger(DomoticLightsSubCommand.name);

  constructor(private readonly domoticService: DomoticService) {
    super();
  }

  async run(inputs: string[], options: LightsOptions): Promise<void> {
    try {
      const lights = await this.domoticService.resolveTargets({ room: options.room });

      if (lights.length === 0) {
        this.logger.warn('The bridge lists no lights.');
        return;
      }

      const rows = lights.map((light) => ({
        room: light.room ?? '-',
        label: light.label ?? '-',
        name: light.name,
        state: light.on ? `on ${light.brightness !== undefined ? `${Math.round(light.brightness)}%` : ''}`.trim() : 'off',
        effect: light.effect,
        id: light.id,
      }));

      console.table(rows);
    } catch (error) {
      this.logger.error(`Could not list the lights: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-r, --room <room>',
    description: 'Only the lights of one room, as named in files/hue-<room>.yaml',
  })
  parseRoom(val: string): string {
    return val;
  }
}
