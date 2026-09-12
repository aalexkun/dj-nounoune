import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { DomoticService } from '../../services/domotic/domotic.service';
import { FileService } from '../../services/file/file.service';
import { getErrorMessage } from '../../utils/error.utils';

interface RoomsOptions {
  write?: boolean;
}

/** The room configuration as JSON: what the lighting designer is grounded on, rendered from the yaml. */
@SubCommand({
  name: 'rooms',
  description: 'Print the room configuration (rooms, plans, lights) as JSON, built from files/hue-<room>.yaml',
})
@Injectable()
export class DomoticRoomsSubCommand extends CommandRunner {
  private readonly logger = new Logger(DomoticRoomsSubCommand.name);

  constructor(
    private readonly domoticService: DomoticService,
    private readonly fileService: FileService,
  ) {
    super();
  }

  async run(inputs: string[], options: RoomsOptions): Promise<void> {
    try {
      const rooms = await this.domoticService.getRoomConfig();
      const json = JSON.stringify(rooms, null, 2);

      if (options.write) {
        await this.fileService.saveFile('hue-rooms.json', json);
        this.logger.log(`Wrote ${rooms.length} room(s) to files/hue-rooms.json`);
        return;
      }

      console.log(json);
    } catch (error) {
      this.logger.error(`Could not build the room configuration: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-w, --write',
    description: 'Write the JSON to files/hue-rooms.json instead of printing it',
    defaultValue: false,
  })
  parseWrite(): boolean {
    return true;
  }
}
