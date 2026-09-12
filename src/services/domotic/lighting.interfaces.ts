import { z } from 'zod';
import { HUE_EFFECTS, HueLight, HueLightUpdate } from './hue.interfaces';

/**
 * The shapes the lighting tools and the CLI speak: human units in, bridge units out.
 *
 * `LightingUpdateSchema` is what a tool call is validated against. It is deliberately the shape a
 * person would write — a light by name, a colour as hex, a white as Kelvin — and `DomoticService`
 * turns it into a {@link HueLightUpdate} against the live light it resolves to. Unknown keys are
 * stripped rather than refused: a model that adds a `note` field should not lose the whole call.
 */

export const LightingUpdateSchema = z.object({
  target: z.string().min(1),
  on: z.boolean().optional(),
  brightness: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
  kelvin: z.number().min(1000).max(10_000).optional(),
  effect: z.enum(HUE_EFFECTS).optional(),
  transitionMs: z.number().min(0).max(60_000).optional(),
});
export type LightingUpdate = z.infer<typeof LightingUpdateSchema>;

export const LightingUpdatesSchema = z.array(LightingUpdateSchema).min(1);

/** A light as `resolveLightingUpdates` found it, with the bridge-unit write it worked out. */
export interface ResolvedLightingUpdate {
  light: HueLight;
  update: HueLightUpdate;
}

/** A light a selection could not resolve, or a write the bridge refused. */
export interface LightingFailure {
  target: string;
  reason: string;
}

export interface LightingResult {
  applied: ResolvedLightingUpdate[];
  failed: LightingFailure[];
  dryRun: boolean;
}

/** The room configuration as the lighting model and `domotic rooms` see it: the yaml, as JSON. */
export interface RoomConfig {
  room: string;
  slug: string;
  /** The placement sketch; positions read left to right, top to bottom as on a plan. */
  grid: string;
  lights: Array<{
    label: string;
    id: string;
    name: string;
    archetype?: string;
  }>;
}
