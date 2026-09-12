import { Content } from '@google/genai';
import { HueLight, HueLightUpdate } from '../../../domotic/hue.interfaces';
import { mirekToKelvin } from '../../../domotic/hue-color.util';
import { LightingResult, RoomConfig } from '../../../domotic/lighting.interfaces';
import { SavedScene } from '../../../domotic/lighting-scene.service';
import { HouseholdLightingMemory } from '../../../domotic/lighting-memory.service';

/**
 * Everything the lighting designer is told about the house at the start of a request, and the
 * renderers that turn it into the text the model reads.
 *
 * Rendered as text rather than sent as JSON blobs: the model reads the room sketch as a plan, the
 * light states as a list it can scan, and the memory as prose. The one JSON element is the light
 * list per room, because ids and labels are exactly what a tool call has to echo back.
 */
export interface LightingBrief {
  rooms: RoomConfig[];
  lights: HueLight[];
  scenes: SavedScene[];
  memory: HouseholdLightingMemory;
}

/** A tool-call argument longer than this says nothing more about what happened. */
const MAX_ACTION_CHARS = 400;

export function renderRooms(rooms: RoomConfig[]): string {
  if (rooms.length === 0) return 'No room map is configured; every light is unplaced.';

  return rooms
    .map((room) => {
      const lights = JSON.stringify(
        room.lights.map((light) => ({ label: light.label, name: light.name, archetype: light.archetype })),
        null,
        0,
      );
      const grid = room.grid ? `Plan (overhead, left to right and top to bottom as drawn):\n${room.grid}` : 'No plan drawn.';

      return `## ${room.room}\n${grid}\nLights: ${lights}`;
    })
    .join('\n\n');
}

export function renderCurrentState(lights: HueLight[]): string {
  if (lights.length === 0) return 'The bridge lists no lights.';

  const byRoom = new Map<string, HueLight[]>();

  for (const light of lights) {
    const room = light.room ?? 'Unplaced';
    byRoom.set(room, [...(byRoom.get(room) ?? []), light]);
  }

  return [...byRoom.entries()]
    .map(([room, entries]) => `${room}:\n${entries.map((light) => `- ${describeLightState(light)}`).join('\n')}`)
    .join('\n');
}

/** `Flower (Flower lamp 🪔, pendant_round): on 100%, warm white 2700K, colour-capable`. */
export function describeLightState(light: HueLight): string {
  const label = light.label && light.label !== light.name ? `${light.label} (${light.name}` : `${light.name} (`;
  const head = `${label}${light.archetype ? `${light.label && light.label !== light.name ? ', ' : ''}${light.archetype}` : ''})`;

  if (!light.on) {
    return `${head}: off${capabilities(light)}`;
  }

  const parts: string[] = [`on ${light.brightness !== undefined ? `${Math.round(light.brightness)}%` : ''}`.trim()];

  if (light.mirek !== undefined) {
    parts.push(`white ${mirekToKelvin(light.mirek)}K`);
  } else if (light.colorXy) {
    parts.push(`colour xy(${light.colorXy.x}, ${light.colorXy.y})`);
  }

  if (light.effect !== 'no_effect') parts.push(`effect ${light.effect}`);

  return `${head}: ${parts.join(', ')}${capabilities(light)}`;
}

function capabilities(light: HueLight): string {
  const notes: string[] = [];
  if (!light.supportsColor) notes.push('white only');
  if (light.supportedEffects.length === 0) notes.push('no effects');
  return notes.length > 0 ? ` [${notes.join(', ')}]` : '';
}

export function renderScenes(scenes: SavedScene[]): string {
  if (scenes.length === 0) return 'None saved yet.';

  return scenes
    .map((scene) => {
      const where = scene.room ? ` (${scene.room})` : '';
      const what = scene.description ? `: ${scene.description}` : '';
      return `- "${scene.title}"${where}${what} — ${scene.states.length} light(s)`;
    })
    .join('\n');
}

export function renderMemory(memory: HouseholdLightingMemory): string {
  const summary = memory.summary.trim() || 'Nothing yet: this is one of the first requests.';
  const recent = memory.recent.slice(-6);

  if (recent.length === 0) return summary;

  const log = recent
    .map((entry) => {
      const when = entry.at instanceof Date ? entry.at.toISOString().slice(0, 16).replace('T', ' ') : '';
      const actions = entry.actions.length > 0 ? entry.actions.join('; ') : 'no change made';
      return `- ${when} "${entry.request}" -> ${actions}`;
    })
    .join('\n');

  return `${summary}\n\nMost recent requests, oldest first:\n${log}`;
}

/** `on, 40%, white 2700K, effect candle, fade 2000ms` — what a write did, for the tool reply. */
export function describeHueUpdate(update: HueLightUpdate): string {
  const parts: string[] = [];

  if (update.on !== undefined) parts.push(update.on ? 'on' : 'off');
  if (update.brightness !== undefined) parts.push(`${Math.round(update.brightness)}%`);
  if (update.colorXy) parts.push(`colour xy(${update.colorXy.x}, ${update.colorXy.y})`);
  if (update.mirek !== undefined) parts.push(`white ${mirekToKelvin(update.mirek)}K`);
  if (update.effect !== undefined) parts.push(update.effect === 'no_effect' ? 'effect stopped' : `effect ${update.effect}`);
  if (update.transitionMs !== undefined) parts.push(`fade ${update.transitionMs}ms`);

  return parts.join(', ') || 'nothing';
}

/** The tool reply for a batch of writes: one line per light, pipe-separated to save tokens. */
export function renderLightingResult(result: LightingResult): string {
  const lines = [`${result.dryRun ? 'would set' : 'set'} ${result.applied.length} light(s), ${result.failed.length} failed`];

  for (const entry of result.applied) {
    lines.push(`ok|${entry.light.label ?? entry.light.name}|${describeHueUpdate(entry.update)}`);
  }

  for (const failure of result.failed) {
    lines.push(`failed|${failure.target}|${failure.reason}`);
  }

  return lines.join('\n');
}

/**
 * The tool calls a finished request made, read back off its history. This is what the memory
 * summariser sees of what the designer did, and what the memory log records.
 */
export function describeActions(history: Content[]): string[] {
  const actions: string[] = [];

  for (const content of history) {
    for (const part of content.parts ?? []) {
      const call = part.functionCall;
      if (!call?.name) continue;

      const args = JSON.stringify(call.args ?? {});
      actions.push(`${call.name}(${args.length > MAX_ACTION_CHARS ? `${args.slice(0, MAX_ACTION_CHARS)}…` : args})`);
    }
  }

  return actions;
}
