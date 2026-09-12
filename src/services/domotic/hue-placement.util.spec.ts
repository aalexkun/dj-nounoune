import { normalizeRoomName, parseLegendLine, parsePlacement, placementMatchesRoom, slugFromFilename } from './hue-placement.util';

const LIVING_ROOM = [
  'room: Living Room',
  'view: Overhead',
  '',
  'grid: |',
  '  [Top Left]                                     [Top Right]',
  '       (Flower)                                   ',
  '      /      \\                                    (Shrine) --- (Lower div)',
  '',
  'legend:',
  '  Flower: { id: "08737482-2194-4cc2-b814-ed17df587296", name: "Flower lamp", archetype: "pendant_round" }',
  '  Shrine: { id: "9aa7642e-5048-46cb-a88f-72f791f25bae", name: "Possums\' shrine ", archetype: "table_shade" }',
  '  Lower div: { id: "6efb28cf-1661-4cd6-8528-30942ccbb1e8", name: "Lower divinity", archetype: "candle_bulb" }[cite: 1]',
  '  Broken: { id: "not-a-uuid", name: "x" }',
].join('\r\n');

describe('hue-placement.util', () => {
  describe('parsePlacement', () => {
    const placement = parsePlacement(LIVING_ROOM, 'living-room');

    it('reads the room name and keeps the slug', () => {
      expect(placement.room).toBe('Living Room');
      expect(placement.slug).toBe('living-room');
    });

    it('reads the legend and nothing from the grid', () => {
      expect(placement.lights.map((light) => light.label)).toEqual(['Flower', 'Shrine', 'Lower div']);
    });

    it('keeps the grid sketch, dedented, with its inner alignment', () => {
      const lines = placement.grid.split('\n');
      expect(lines[0]).toBe('[Top Left]                                     [Top Right]');
      expect(lines[1]).toBe('     (Flower)');
      expect(lines[lines.length - 1]).toContain('(Shrine) --- (Lower div)');
    });

    it('has an empty grid when the file draws none', () => {
      expect(parsePlacement('room: Attic\nlegend:\n', 'attic').grid).toBe('');
    });

    it('keeps a label with a space and a name with an apostrophe', () => {
      const shrine = placement.lights.find((light) => light.label === 'Shrine');
      expect(shrine?.name).toBe("Possums' shrine ");
      expect(shrine?.archetype).toBe('table_shade');
    });

    it('ignores trailing annotations after the closing brace', () => {
      expect(placement.lights.find((light) => light.label === 'Lower div')?.id).toBe('6efb28cf-1661-4cd6-8528-30942ccbb1e8');
    });

    it('drops an entry whose id is not a uuid', () => {
      expect(placement.lights.some((light) => light.label === 'Broken')).toBe(false);
    });

    it('falls back to the slug when the file names no room', () => {
      expect(parsePlacement('legend:\n  A: { id: "08737482-2194-4cc2-b814-ed17df587296", name: "A" }', 'attic').room).toBe('attic');
    });
  });

  describe('parseLegendLine', () => {
    it('returns undefined on a grid line', () => {
      expect(parseLegendLine('  (Flower)  (Rose)')).toBeUndefined();
    });

    it('accepts a missing archetype', () => {
      expect(parseLegendLine('  A: { id: "08737482-2194-4cc2-b814-ed17df587296", name: "A" }')?.archetype).toBeUndefined();
    });
  });

  describe('room matching', () => {
    const placement = { room: 'Living Room', slug: 'living-room', lights: [] };

    it('normalises spacing, case and punctuation', () => {
      expect(normalizeRoomName(' LIVING-Room ')).toBe('livingroom');
    });

    it('matches the room name or the slug however it is spelt', () => {
      expect(placementMatchesRoom(placement, 'living room')).toBe(true);
      expect(placementMatchesRoom(placement, 'LIVING-ROOM')).toBe(true);
      expect(placementMatchesRoom(placement, 'bedroom')).toBe(false);
      expect(placementMatchesRoom(placement, '')).toBe(false);
    });

    it('derives the slug from the filename', () => {
      expect(slugFromFilename('hue-bed-room.yaml')).toBe('bed-room');
      expect(slugFromFilename('kitchen.yml')).toBe('kitchen');
    });
  });
});
