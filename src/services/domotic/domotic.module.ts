import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HueClientService } from './hue-client.service';
import { DomoticService } from './domotic.service';
import { LightingSceneService } from './lighting-scene.service';
import { LightingMemoryService } from './lighting-memory.service';
import { LightingScene, LightingSceneSchema } from '../../schemas/lighting-scene.schema';
import { LightingMemory, LightingMemorySchema } from '../../schemas/lighting-memory.schema';

/**
 * Home automation: the Philips Hue lights, for now.
 *
 * `HueClientService` is the bridge transport and `DomoticService` is what the rest of the
 * application talks to. The two stores are the lighting designer's: `LightingSceneService` keeps
 * the arrangements the household named, `LightingMemoryService` what the designer has learnt.
 * Nothing in here touches MPD or the music collections.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: LightingScene.name, schema: LightingSceneSchema },
      { name: LightingMemory.name, schema: LightingMemorySchema },
    ]),
  ],
  providers: [HueClientService, DomoticService, LightingSceneService, LightingMemoryService],
  exports: [HueClientService, DomoticService, LightingSceneService, LightingMemoryService],
})
export class DomoticModule {}
