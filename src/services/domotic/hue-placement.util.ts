import { z } from 'zod';

/**
 * Reader for the `files/hue-<room>.yaml` placement files.
 *
 * Each file describes one room: a `room:` name, a free-form `grid: |` sketch of where the lamps
 * stand, and a `legend:` mapping the sketch's short labels to the bridge's ids. The grid is a
 * drawing for people, and for the lighting model, which reads "left", "top" and "next to" off it;
 * the legend is the only structured data. This reads all three line by line rather than pulling a
 * YAML parser in for a format this narrow.
 *
 * The legend entries are single-line flow mappings (`Label: { id: "...", name: "...", archetype: "..." }`).
 * Anything after the closing brace is ignored on purpose: the files are hand-written and have
 * carried trailing annotations before.
 */

export const PlacedLightSchema = z.object({
  label: z.string().min(1),
  id: z.string().uuid(),
  name: z.string(),
  archetype: z.string().optional(),
});
export type PlacedLight = z.infer<typeof PlacedLightSchema>;

export interface RoomPlacement {
  /** As written in the file, e.g. `Living Room`. */
  room: string;
  /** The file's own stem, e.g. `living-room` from `hue-living-room.yaml`. */
  slug: string;
  /** The `grid: |` sketch verbatim, dedented, empty when the file has none. */
  grid: string;
  lights: PlacedLight[];
}

/** `Living Room`, `living-room`, `livingroom` and ` LIVING ROOM ` all reduce to `livingroom`. */
export function normalizeRoomName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Whether a room, named any of the ways people name it, is the one a placement describes.
 * Matches the file's room name or its slug.
 */
export function placementMatchesRoom(placement: RoomPlacement, wanted: string): boolean {
  const target = normalizeRoomName(wanted);
  return target.length > 0 && (normalizeRoomName(placement.room) === target || normalizeRoomName(placement.slug) === target);
}

/** `hue-living-room.yaml` -> `living-room`. Anything else is returned as its own stem. */
export function slugFromFilename(filename: string): string {
  return filename.replace(/\.ya?ml$/i, '').replace(/^hue-/, '');
}

/**
 * Parses one placement file.
 *
 * @param content - The file's text
 * @param slug - The file's slug, used as the room name when the file has none
 * @returns The room, its sketch and its legend; a legend line that does not parse is skipped, not fatal
 */
export function parsePlacement(content: string, slug: string): RoomPlacement {
  const lines = content.split(/\r?\n/);
  const lights: PlacedLight[] = [];
  const gridLines: string[] = [];
  let room: string | undefined;
  let section: 'legend' | 'grid' | undefined;

  for (const line of lines) {
    const topLevel = line.trim().length > 0 && !/^\s/.test(line);

    if (topLevel) {
      const colon = line.indexOf(':');
      const key = (colon < 0 ? line : line.slice(0, colon)).trim();
      section = key === 'legend' ? 'legend' : key === 'grid' ? 'grid' : undefined;

      if (key === 'room' && colon >= 0) {
        room = unquote(line.slice(colon + 1));
      }
      continue;
    }

    if (section === 'grid') {
      gridLines.push(line);
      continue;
    }

    if (section !== 'legend' || line.trim().length === 0) continue;

    const entry = parseLegendLine(line);
    if (entry) lights.push(entry);
  }

  return { room: room && room.length > 0 ? room : slug, slug, grid: dedent(gridLines), lights };
}

/**
 * `  Label: { id: "...", name: "...", archetype: "..." }` -> a {@link PlacedLight}, or undefined
 * when the line is not shaped like that or fails validation.
 */
export function parseLegendLine(line: string): PlacedLight | undefined {
  const open = line.indexOf('{');
  const close = line.indexOf('}', open);

  if (open < 0 || close < 0) return undefined;

  const head = line.slice(0, open);
  const colon = head.lastIndexOf(':');

  if (colon < 0) return undefined;

  const label = unquote(head.slice(0, colon));
  const fields: Record<string, string> = {};

  for (const match of line.slice(open + 1, close).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]*)"/g)) {
    fields[match[1]] = match[2];
  }

  const parsed = PlacedLightSchema.safeParse({ label, ...fields });

  return parsed.success ? parsed.data : undefined;
}

/** Strips the block indentation and the blank lines at either end, keeping the inner alignment. */
function dedent(lines: string[]): string {
  const kept = [...lines];

  while (kept.length > 0 && kept[0].trim().length === 0) kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim().length === 0) kept.pop();

  const indent = kept.filter((line) => line.trim().length > 0).reduce((min, line) => Math.min(min, line.length - line.trimStart().length), Infinity);

  return kept.map((line) => (Number.isFinite(indent) ? line.slice(indent) : line).trimEnd()).join('\n');
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const doubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"');
  const singleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'");

  if (trimmed.length >= 2 && (doubleQuoted || singleQuoted)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
