import { hexToXy, kelvinToMirek, mirekToKelvin, parseHexColor } from './hue-color.util';

describe('hue-color.util', () => {
  describe('parseHexColor', () => {
    it('reads six and three digit forms, with or without the hash', () => {
      expect(parseHexColor('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
      expect(parseHexColor('ff8800')).toEqual({ r: 255, g: 136, b: 0 });
      expect(parseHexColor('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('refuses anything else', () => {
      expect(parseHexColor('red')).toBeUndefined();
      expect(parseHexColor('#ff88')).toBeUndefined();
      expect(parseHexColor('')).toBeUndefined();
    });
  });

  describe('hexToXy', () => {
    it('puts pure red near the red corner of the gamut', () => {
      const xy = hexToXy('#ff0000');
      expect(xy?.x).toBeGreaterThan(0.6);
      expect(xy?.y).toBeLessThan(0.35);
    });

    it('puts pure blue near the blue corner', () => {
      const xy = hexToXy('#0000ff');
      expect(xy?.x).toBeLessThan(0.2);
      expect(xy?.y).toBeLessThan(0.1);
    });

    it('puts white near the D65 white point', () => {
      const xy = hexToXy('#ffffff');
      expect(xy?.x).toBeCloseTo(0.3227, 1);
      expect(xy?.y).toBeCloseTo(0.329, 1);
    });

    it('answers black with a warm white rather than dividing by zero', () => {
      expect(hexToXy('#000000')).toEqual({ x: 0.4583, y: 0.4099 });
    });

    it('is undefined for a value that is not a colour', () => {
      expect(hexToXy('warm')).toBeUndefined();
    });
  });

  describe('temperature', () => {
    it('converts Kelvin to mirek and clamps to the bulb range', () => {
      expect(kelvinToMirek(2700)).toBe(370);
      expect(kelvinToMirek(4000)).toBe(250);
      expect(kelvinToMirek(1000)).toBe(500);
      // 10,000 K clamps to 6,500 K first, and 1e6 / 6500 rounds to 154.
      expect(kelvinToMirek(10000)).toBe(154);
    });

    it('converts mirek back to a Kelvin nobody would misread', () => {
      expect(mirekToKelvin(370)).toBe(2700);
      expect(mirekToKelvin(153)).toBe(6550);
      expect(mirekToKelvin(0)).toBe(6500);
    });
  });
});
