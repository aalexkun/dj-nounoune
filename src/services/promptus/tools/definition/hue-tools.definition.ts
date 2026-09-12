import { Schema, Type } from '@google/genai';
import { ToolDeclaration } from '../tool.type';
import { HUE_EFFECTS } from '../../../domotic/hue.interfaces';

/**
 * One light's change, in the units a person would use. Shared by `hue_apply_lighting` and
 * `hue_save_scene` so a scene is saved in exactly the form it would have been applied.
 */
const lightingUpdateSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    target: {
      type: Type.STRING,
      description:
        'Which light: its label from the room map (e.g. "Flower", "Petite 🐭"), its bridge name, or its id. One light per entry; ambiguous names are refused, so prefer the label.',
    },
    on: {
      type: Type.BOOLEAN,
      description: 'true to turn the light on, false to turn it off. Setting a brightness, colour or effect does not turn a light on by itself.',
    },
    brightness: {
      type: Type.NUMBER,
      description: 'Brightness 1 to 100. Around 10-25 is a night-time glow, 40-60 an evening living room, 100 is working light.',
    },
    color: {
      type: Type.STRING,
      description:
        'A colour as a hex code, e.g. "#ff8c00" for amber. Give either color or kelvin, not both; color wins if both are given. Only for lights the state lists as colour-capable.',
    },
    kelvin: {
      type: Type.NUMBER,
      description:
        'A white, as a colour temperature in Kelvin: 2000 is candle-orange, 2700 a warm bulb, 4000 neutral, 5000-6500 cool daylight. Give either kelvin or color, not both.',
    },
    effect: {
      type: Type.STRING,
      format: 'enum',
      enum: [...HUE_EFFECTS],
      description:
        'A dynamic effect to run on the light, or no_effect to stop one. An effect overrides colour while it runs; setting a colour or kelvin without an effect stops any running effect automatically.',
    },
    transitionMs: {
      type: Type.NUMBER,
      description: 'Fade duration in milliseconds. Omit for the default 400 ms; use 2000-5000 for a slow, gentle change.',
    },
  },
  required: ['target'],
};

export class HueToolsDefinition {
  private constructor() {}

  public static readonly readLights: ToolDeclaration = {
    name: 'hue_read_lights',
    description:
      'Re-read the live state of the lights from the Hue bridge. The state you were given at the start of the request is already current, so call this only after your own hue_apply_lighting if you need to confirm what the bridge holds now, or when the user asks what the lights are doing.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        room: {
          type: Type.STRING,
          description: 'Restrict to one room, as named in the room map. Omit for every light.',
        },
      },
    },
  } as const;

  public static readonly applyLighting: ToolDeclaration = {
    name: 'hue_apply_lighting',
    description:
      'Write a new state to one or more lights, all in one call. Give every light you want changed as its own entry; lights you leave out are untouched. The result names each light that was set and each that failed, with the reason — a failed entry means that light did not change, so fix it and call again for that light only.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        room: {
          type: Type.STRING,
          description:
            'The room the targets are in, as named in the room map. Set it whenever the request concerns one room: it makes a label like "🐭 zone" unambiguous.',
        },
        updates: {
          type: Type.ARRAY,
          description: 'One entry per light to change.',
          items: lightingUpdateSchema,
        },
      },
      required: ['updates'],
    },
  } as const;

  public static readonly saveScene: ToolDeclaration = {
    name: 'hue_save_scene',
    description:
      'Save an arrangement under a name so it can be recalled later with hue_apply_scene. Only when the user asks to keep, save, remember or name a lighting setup. Saving does not apply anything: call hue_apply_lighting as well if the lights should change now. Saving over an existing name replaces it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'The name the user gave, as they said it, e.g. "movie night" or "reading".',
        },
        description: {
          type: Type.STRING,
          description: 'One sentence on what the scene is for and how it looks, so it can be listed later.',
        },
        room: {
          type: Type.STRING,
          description: 'The room the scene belongs to, when it concerns one room.',
        },
        updates: {
          type: Type.ARRAY,
          description: 'The per-light states that make up the scene, in the same form as hue_apply_lighting.',
          items: lightingUpdateSchema,
        },
      },
      required: ['title', 'updates'],
    },
  } as const;

  public static readonly applyScene: ToolDeclaration = {
    name: 'hue_apply_scene',
    description:
      'Recall a saved scene by name and write it to the lights. Use it when the user names a scene from the SAVED SCENES list. If no scene of that name exists the result says so; then compose the lighting yourself with hue_apply_lighting instead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'The scene name, as listed.',
        },
      },
      required: ['title'],
    },
  } as const;
}
