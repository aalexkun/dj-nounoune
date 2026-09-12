import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { getErrorMessage } from '../../utils/error.utils';
import { HueClientService } from './hue-client.service';
import { HueEffect, HueLight, HueLightResource, HueLightUpdate } from './hue.interfaces';
import { hexToXy, kelvinToMirek } from './hue-color.util';
import { PlacedLight, RoomPlacement, parsePlacement, placementMatchesRoom, slugFromFilename } from './hue-placement.util';
import { LightingFailure, LightingResult, LightingUpdate, ResolvedLightingUpdate, RoomConfig } from './lighting.interfaces';

/**
 * The bridge asks for no more than ten light commands a second. Sequential puts a tenth of a
 * second apart stay under that whatever the room size.
 */
const COMMAND_SPACING_MS = 100;

/** How the effect should be applied, and to which lights. */
export interface EffectTargetSelection {
  /** Labels, names or ids. Empty means every light in the room, or every light when no room. */
  lights?: string[];
  /** A room from the placement files. */
  room?: string;
}

export interface EffectApplication {
  effect: HueEffect;
  targets: HueLight[];
  /** Lights the effect was written to, by name. */
  applied: string[];
  /** Lights the bridge refused, with the reason. */
  failed: Array<{ light: HueLight; reason: string }>;
  dryRun: boolean;
}

/**
 * The house's lights, seen through the Hue bridge and the placement files.
 *
 * The bridge is the source of truth for what a light is and what it is doing. The placement files
 * under `files/hue-*.yaml` add the two things the bridge does not know: which room a light stands
 * in and the short label a person uses for it. A light on the bridge with no placement is still a
 * light, listed without a room; a placement whose light the bridge no longer has is logged and
 * dropped.
 */
@Injectable()
export class DomoticService {
  private readonly logger = new Logger(DomoticService.name);

  constructor(private readonly hueClient: HueClientService) {}

  /** Every light the bridge knows, each placed in its room when a placement file says which. */
  async listLights(): Promise<HueLight[]> {
    const [resources, placements] = await Promise.all([this.hueClient.getLights(), this.loadPlacements()]);
    const placedById = new Map<string, { room: string; light: PlacedLight }>();

    for (const placement of placements) {
      for (const light of placement.lights) {
        placedById.set(light.id, { room: placement.room, light });
      }
    }

    const lights = resources.map((resource) => toLight(resource, placedById.get(resource.id)));
    const known = new Set(lights.map((light) => light.id));

    for (const [id, placed] of placedById) {
      if (!known.has(id)) {
        this.logger.warn(`Placement "${placed.light.label}" (${placed.room}) names light ${id}, which the bridge does not list.`);
      }
    }

    return lights;
  }

  /**
   * The placement files as one JSON structure: what `domotic rooms` prints and what the lighting
   * model is grounded on. The yaml stays the source; this is its rendering.
   */
  async getRoomConfig(): Promise<RoomConfig[]> {
    const placements = await this.loadPlacements();

    return placements.map((placement) => ({
      room: placement.room,
      slug: placement.slug,
      grid: placement.grid,
      lights: placement.lights.map((light) => ({ label: light.label, id: light.id, name: light.name, archetype: light.archetype })),
    }));
  }

  /**
   * Runs an effect on a set of lights.
   *
   * A real effect is only visible on a light that is on, so it is switched on in the same write.
   * `no_effect` leaves the on-state alone: stopping the candle should not also turn the lamp off,
   * nor on.
   */
  async applyEffect(effect: HueEffect, selection: EffectTargetSelection, dryRun = false): Promise<EffectApplication> {
    const targets = await this.resolveTargets(selection);
    const result: EffectApplication = { effect, targets, applied: [], failed: [], dryRun };

    if (targets.length === 0) return result;

    for (const [index, light] of targets.entries()) {
      if (!light.supportedEffects.includes(effect)) {
        result.failed.push({ light, reason: `does not support "${effect}" (accepts ${light.supportedEffects.join(', ') || 'no effect at all'})` });
        continue;
      }

      if (dryRun) {
        result.applied.push(light.name);
        continue;
      }

      try {
        await this.hueClient.updateLight(light.id, effect === 'no_effect' ? { effect } : { on: true, effect });
        result.applied.push(light.name);
      } catch (error) {
        result.failed.push({ light, reason: getErrorMessage(error) });
      }

      if (index < targets.length - 1) {
        await sleep(COMMAND_SPACING_MS);
      }
    }

    return result;
  }

  /**
   * Turns human-unit updates into bridge writes against the live lights, without sending any.
   *
   * Each `target` is resolved the same way the CLI resolves a light: label, bridge name or id,
   * exact first then unique substring, within `room` when one is given. A target that resolves to
   * nothing, or to several lights, is a failure for that entry and the others still go through.
   *
   * Two translations are not unit changes:
   *  - a colour or a white on a light running an effect also stops the effect, unless the same
   *    entry sets one. An effect owns the colour while it runs, so the write would otherwise be
   *    invisible.
   *  - `color` wins over `kelvin` when an entry carries both; the bridge keeps only one.
   */
  async resolveLightingUpdates(updates: LightingUpdate[], room?: string): Promise<{ resolved: ResolvedLightingUpdate[]; failed: LightingFailure[] }> {
    const pool = await this.resolveTargets({ room });
    const resolved: ResolvedLightingUpdate[] = [];
    const failed: LightingFailure[] = [];
    const seen = new Set<string>();

    for (const entry of updates) {
      let light: HueLight;

      try {
        light = findLight(pool, entry.target);
      } catch (error) {
        failed.push({ target: entry.target, reason: getErrorMessage(error) });
        continue;
      }

      if (seen.has(light.id)) {
        failed.push({ target: entry.target, reason: `${light.name} is already set by an earlier entry of the same request` });
        continue;
      }

      const update = toHueUpdate(entry, light);

      if (!update) {
        failed.push({ target: entry.target, reason: `"${entry.color ?? ''}" is not a hex colour such as #ff8800` });
        continue;
      }

      if (Object.keys(update).length === 0) {
        failed.push({ target: entry.target, reason: 'nothing to change: give at least one of on, brightness, color, kelvin or effect' });
        continue;
      }

      if (update.effect && update.effect !== 'no_effect' && !light.supportedEffects.includes(update.effect)) {
        failed.push({ target: entry.target, reason: `${light.name} does not support "${update.effect}"` });
        continue;
      }

      if (update.colorXy && !light.supportsColor) {
        failed.push({ target: entry.target, reason: `${light.name} cannot show a colour; give it a kelvin instead` });
        continue;
      }

      seen.add(light.id);
      resolved.push({ light, update });
    }

    return { resolved, failed };
  }

  /** {@link resolveLightingUpdates}, then the writes, one light at a time. */
  async applyLighting(updates: LightingUpdate[], room?: string, dryRun = false): Promise<LightingResult> {
    const { resolved, failed } = await this.resolveLightingUpdates(updates, room);
    const outcome = await this.applyResolved(resolved, dryRun);

    return { applied: outcome.applied, failed: [...failed, ...outcome.failed], dryRun };
  }

  /** Sends already-resolved writes to the bridge, spaced under its rate guidance. */
  async applyResolved(resolved: ResolvedLightingUpdate[], dryRun = false): Promise<LightingResult> {
    const applied: ResolvedLightingUpdate[] = [];
    const failed: LightingFailure[] = [];

    for (const [index, entry] of resolved.entries()) {
      if (dryRun) {
        applied.push(entry);
        continue;
      }

      try {
        await this.hueClient.updateLight(entry.light.id, entry.update);
        applied.push(entry);
      } catch (error) {
        failed.push({ target: entry.light.name, reason: getErrorMessage(error) });
      }

      if (index < resolved.length - 1) {
        await sleep(COMMAND_SPACING_MS);
      }
    }

    return { applied, failed, dryRun };
  }

  /**
   * Writes a bridge-unit update to a light by id, for callers that stored the resolution — a saved
   * scene. The light is looked up so the caller gets a name back, and a missing light is a failure
   * rather than a throw.
   */
  async applyById(entries: Array<{ lightId: string; update: HueLightUpdate }>, dryRun = false): Promise<LightingResult> {
    const lights = await this.listLights();
    const byId = new Map(lights.map((light) => [light.id, light]));
    const resolved: ResolvedLightingUpdate[] = [];
    const failed: LightingFailure[] = [];

    for (const entry of entries) {
      const light = byId.get(entry.lightId);

      if (!light) {
        failed.push({ target: entry.lightId, reason: 'the bridge no longer lists this light' });
        continue;
      }

      resolved.push({ light, update: entry.update });
    }

    const outcome = await this.applyResolved(resolved, dryRun);

    return { applied: outcome.applied, failed: [...failed, ...outcome.failed], dryRun };
  }

  /**
   * The lights a selection names. A room narrows the pool; names pick from it. A name that
   * matches nothing, or more than one light, is an error rather than a guess: the wrong lamp
   * lighting up is the one outcome that teaches nobody anything.
   */
  async resolveTargets(selection: EffectTargetSelection): Promise<HueLight[]> {
    const all = await this.listLights();
    let pool = all;

    if (selection.room) {
      const placements = await this.loadPlacements();
      const placement = placements.find((candidate) => placementMatchesRoom(candidate, selection.room ?? ''));

      if (!placement) {
        const rooms = placements.map((candidate) => `"${candidate.room}"`).join(', ');
        throw new Error(`No placement file describes room "${selection.room}". Known rooms: ${rooms || 'none'}.`);
      }

      const inRoom = new Set(placement.lights.map((light) => light.id));
      pool = all.filter((light) => inRoom.has(light.id));
    }

    const wanted = (selection.lights ?? []).map((name) => name.trim()).filter((name) => name.length > 0);

    if (wanted.length === 0) return pool;

    const chosen = new Map<string, HueLight>();

    for (const name of wanted) {
      const light = findLight(pool, name);
      chosen.set(light.id, light);
    }

    return [...chosen.values()];
  }

  /** The placement files, read fresh each time so an edit is picked up without a restart. */
  async loadPlacements(): Promise<RoomPlacement[]> {
    const directory = path.join(process.cwd(), 'files');
    let filenames: string[];

    try {
      filenames = (await readdir(directory)).filter((filename) => /^hue-.+\.ya?ml$/i.test(filename)).sort();
    } catch (error) {
      this.logger.warn(`Cannot read placement files from ${directory}: ${getErrorMessage(error)}`);
      return [];
    }

    const placements: RoomPlacement[] = [];

    for (const filename of filenames) {
      try {
        const content = await readFile(path.join(directory, filename), 'utf8');
        placements.push(parsePlacement(content, slugFromFilename(filename)));
      } catch (error) {
        this.logger.warn(`Skipping placement file ${filename}: ${getErrorMessage(error)}`);
      }
    }

    return placements;
  }
}

function toLight(resource: HueLightResource, placed?: { room: string; light: PlacedLight }): HueLight {
  const temperature = resource.color_temperature;
  const inTemperatureMode = temperature?.mirek_valid === true && typeof temperature.mirek === 'number';

  return {
    id: resource.id,
    idV1: resource.id_v1,
    name: resource.metadata.name.trim(),
    archetype: resource.metadata.archetype,
    on: resource.on?.on ?? false,
    brightness: resource.dimming?.brightness,
    effect: resource.effects_v2?.status?.effect ?? resource.effects?.status ?? 'no_effect',
    supportedEffects: resource.effects_v2?.action?.effect_values ?? resource.effects?.effect_values ?? [],
    supportsColor: resource.color !== undefined,
    supportsColorTemperature: temperature !== undefined,
    colorXy: resource.color?.xy,
    mirek: inTemperatureMode ? (temperature.mirek ?? undefined) : undefined,
    mirekRange: temperature?.mirek_schema ? { min: temperature.mirek_schema.mirek_minimum, max: temperature.mirek_schema.mirek_maximum } : undefined,
    room: placed?.room,
    label: placed?.light.label,
  };
}

/**
 * Human units to bridge units for one light. Undefined when `color` is set but is not a hex
 * colour — the one input that cannot be translated rather than clamped.
 */
function toHueUpdate(entry: LightingUpdate, light: HueLight): HueLightUpdate | undefined {
  const update: HueLightUpdate = {};

  if (entry.on !== undefined) update.on = entry.on;
  if (entry.brightness !== undefined) update.brightness = Math.round(entry.brightness * 10) / 10;
  if (entry.transitionMs !== undefined) update.transitionMs = Math.round(entry.transitionMs);
  if (entry.effect !== undefined) update.effect = entry.effect;

  if (entry.color !== undefined) {
    const xy = hexToXy(entry.color);
    if (!xy) return undefined;
    update.colorXy = xy;
  } else if (entry.kelvin !== undefined) {
    const mirek = kelvinToMirek(entry.kelvin);
    const range = light.mirekRange;
    update.mirek = range ? Math.min(range.max, Math.max(range.min, mirek)) : mirek;
  }

  // A colour written under a running effect is never seen. Stop the effect unless the entry says
  // which effect it wants instead.
  if ((update.colorXy || update.mirek !== undefined) && update.effect === undefined && light.effect !== 'no_effect') {
    update.effect = 'no_effect';
  }

  return update;
}

/**
 * One light by label, name or id. Exact (case-folded, trimmed) match first, then a unique
 * substring match as a convenience for the long emoji names; anything ambiguous is refused.
 */
function findLight(pool: HueLight[], wanted: string): HueLight {
  const target = fold(wanted);
  const exact = pool.filter((light) =>
    [light.id, light.name, light.label, light.idV1].some((value) => value !== undefined && fold(value) === target),
  );

  if (exact.length === 1) return exact[0];

  if (exact.length === 0) {
    const partial = pool.filter((light) => [light.name, light.label].some((value) => value !== undefined && fold(value).includes(target)));

    if (partial.length === 1) return partial[0];

    if (partial.length === 0) {
      throw new Error(`No light matches "${wanted}". Available: ${pool.map((light) => describe(light)).join(', ')}.`);
    }

    throw new Error(`"${wanted}" matches several lights: ${partial.map((light) => describe(light)).join(', ')}. Be more specific.`);
  }

  throw new Error(`"${wanted}" matches several lights: ${exact.map((light) => describe(light)).join(', ')}. Use the id.`);
}

function describe(light: HueLight): string {
  return light.label && fold(light.label) !== fold(light.name) ? `${light.name} (${light.label})` : light.name;
}

function fold(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
