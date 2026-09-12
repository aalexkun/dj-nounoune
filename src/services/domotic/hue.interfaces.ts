import { z } from 'zod';

/**
 * Zod contracts for the Hue CLIP v2 API, plus the domain shapes `DomoticService` hands back.
 *
 * Everything the bridge answers starts as `unknown` and is parsed here. The bridge is generous
 * with optional blocks — a plug has no `dimming`, an older bulb no `effects_v2` — so every block
 * beyond `id` and `metadata` is optional and the readers cope with its absence.
 */

/* -------------------------------------------------------------------------- */
/* Effects                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The effects a Hue light can run, as the bridge spells them. `no_effect` is a value like the
 * others: putting it is how a running effect is stopped.
 *
 * The list is what the lights in `files/hue.json` advertise. A light that lacks one of them says
 * so in `effects_v2.action.effect_values` and the bridge refuses the put, which
 * `HueClientService` surfaces as an error rather than silently ignoring.
 */
export const HUE_EFFECTS = [
  'no_effect',
  'candle',
  'fire',
  'prism',
  'sparkle',
  'opal',
  'glisten',
  'underwater',
  'cosmos',
  'sunbeam',
  'enchant',
] as const;

export type HueEffect = (typeof HUE_EFFECTS)[number];

export function isHueEffect(value: string): value is HueEffect {
  return (HUE_EFFECTS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every CLIP v2 answer, success or failure, is `{ errors, data }`. A refused request often still
 * comes back as HTTP 200 with the reason in `errors`, so the envelope is what decides whether
 * the call worked, not the status code alone.
 */
export const HueEnvelopeSchema = z.object({
  errors: z.array(z.object({ description: z.string() })).default([]),
  data: z.array(z.unknown()).default([]),
});
export type HueEnvelope = z.infer<typeof HueEnvelopeSchema>;

/* -------------------------------------------------------------------------- */
/* Light resource                                                             */
/* -------------------------------------------------------------------------- */

export const HueXySchema = z.object({ x: z.number(), y: z.number() });
export type HueXy = z.infer<typeof HueXySchema>;

/** One `light` resource, reduced to the fields this integration reads. */
export const HueLightResourceSchema = z.object({
  id: z.string(),
  id_v1: z.string().optional(),
  metadata: z.object({
    name: z.string(),
    archetype: z.string().optional(),
  }),
  on: z.object({ on: z.boolean() }).optional(),
  dimming: z.object({ brightness: z.number(), min_dim_level: z.number().optional() }).optional(),
  color_temperature: z
    .object({
      mirek: z.number().nullable().optional(),
      mirek_valid: z.boolean().optional(),
      mirek_schema: z.object({ mirek_minimum: z.number(), mirek_maximum: z.number() }).optional(),
    })
    .optional(),
  color: z.object({ xy: HueXySchema }).optional(),
  effects: z
    .object({
      status: z.string().optional(),
      effect_values: z.array(z.string()).optional(),
    })
    .optional(),
  effects_v2: z
    .object({
      action: z.object({ effect_values: z.array(z.string()).optional() }).optional(),
      status: z.object({ effect: z.string().optional() }).optional(),
    })
    .optional(),
});
export type HueLightResource = z.infer<typeof HueLightResourceSchema>;

/* -------------------------------------------------------------------------- */
/* Domain                                                                     */
/* -------------------------------------------------------------------------- */

/** A light as the rest of the application sees it: the bridge's state plus where it stands. */
export interface HueLight {
  id: string;
  /** The v1 path (`/lights/3`), kept because it is what the Hue app's own diagnostics show. */
  idV1?: string;
  name: string;
  archetype?: string;
  on: boolean;
  /** 0-100, absent on a light that cannot dim. */
  brightness?: number;
  /** The running effect, `no_effect` when none. */
  effect: string;
  /** Effects this particular light accepts. */
  supportedEffects: string[];
  /** Whether the light takes an xy colour at all. */
  supportsColor: boolean;
  /** Whether the light takes a colour temperature at all. */
  supportsColorTemperature: boolean;
  /** Current chromaticity, when the light is in colour mode or reports one. */
  colorXy?: HueXy;
  /** Current colour temperature in mirek, only when the light is actually in temperature mode. */
  mirek?: number;
  /** The mirek span this light accepts, when it reports one. */
  mirekRange?: { min: number; max: number };
  /** Room from the placement files, or undefined when no file places this light. */
  room?: string;
  /** Short label from the placement legend, when one exists. */
  label?: string;
}

/**
 * The state written to a light, in the bridge's own units. Every field is optional; only what is
 * set is sent. `colorXy` and `mirek` are exclusive on the bridge side — the last one written wins —
 * so callers resolve to one of them before getting here.
 */
export interface HueLightUpdate {
  on?: boolean;
  /** 0-100. */
  brightness?: number;
  colorXy?: HueXy;
  mirek?: number;
  effect?: HueEffect;
  /** Fade length in milliseconds; the bridge's default is 400. */
  transitionMs?: number;
}
