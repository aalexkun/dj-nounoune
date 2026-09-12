import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { DomoticLightsSubCommand } from './lights.subcommand';
import { DomoticEffectSubCommand } from './effect.subcommand';
import { DomoticRoomsSubCommand } from './rooms.subcommand';
import { DomoticAskSubCommand } from './ask.subcommand';
import { DomoticScenesSubCommand } from './scenes.subcommand';
import { DomoticMemorySubCommand } from './memory.subcommand';

@Command({
  name: 'domotic',
  description: 'Home automation: Philips Hue lights and the lighting designer agent',
  subCommands: [
    DomoticLightsSubCommand,
    DomoticEffectSubCommand,
    DomoticRoomsSubCommand,
    DomoticAskSubCommand,
    DomoticScenesSubCommand,
    DomoticMemorySubCommand,
  ],
})
@Injectable()
export class DomoticCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Use subcommands: lights, effect, rooms, ask, scenes, memory');
    return Promise.resolve();
  }
}
