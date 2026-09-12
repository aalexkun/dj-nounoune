import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LightingSceneDocument = HydratedDocument<LightingScene>;

/** One light's part in a scene, already in the bridge's units so applying it is a plain put. */
@Schema({ _id: false })
export class LightingSceneState {
  @Prop({ required: true, description: 'Hue light id (CLIP v2 uuid) this state is written to' })
  lightId: string;

  @Prop({ description: 'Placement label or bridge name at the time the scene was saved, for readability' })
  label?: string;

  @Prop({ description: 'Whether the light is on in this scene' })
  on?: boolean;

  @Prop({ description: 'Brightness 0-100' })
  brightness?: number;

  @Prop({ type: Number, description: 'CIE x chromaticity, set together with colorY when the scene gives this light a colour' })
  colorX?: number;

  @Prop({ type: Number, description: 'CIE y chromaticity' })
  colorY?: number;

  @Prop({ description: 'Colour temperature in mirek (1,000,000 / Kelvin), 153 cool to 500 warm, when the scene sets a white' })
  mirek?: number;

  @Prop({ description: 'Hue effect to run: candle, fire, prism, sparkle, opal, glisten, underwater, cosmos, sunbeam, enchant, or no_effect' })
  effect?: string;
}

export const LightingSceneStateSchema = SchemaFactory.createForClass(LightingSceneState);

/**
 * A named lighting arrangement the household asked to keep.
 *
 * Saved by the lighting designer agent when the user says "remember this as ..." and recalled by
 * name afterwards, from the chat or from `domotic scenes`. States are stored resolved — light ids
 * and bridge units — so recalling one is a straight replay with no model in the loop, and so a
 * renamed lamp does not break it.
 */
@Schema({
  timestamps: true,
  autoCreate: true,
  collection: 'lighting_scene',
  versionKey: '__v',
})
export class LightingScene {
  @Prop({ required: true, unique: true, description: 'Lookup key: the title lower-cased, trimmed, spaces collapsed' })
  key: string;

  @Prop({ required: true, description: 'The name the user gave the scene, as they said it' })
  title: string;

  @Prop({ description: 'One sentence on what the scene is for, written by the agent when it saved it' })
  description?: string;

  @Prop({ description: 'Room the scene belongs to, as named in the placement file, when it concerns one room' })
  room?: string;

  @Prop({ type: [LightingSceneStateSchema], default: [], description: 'Per-light states, in bridge units' })
  states: LightingSceneState[];

  @Prop({ description: 'Who saved it: agent or cli' })
  createdBy?: string;
}

export const LightingSceneSchema = SchemaFactory.createForClass(LightingScene);
