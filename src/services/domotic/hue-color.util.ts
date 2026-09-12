import { HueXy } from './hue.interfaces';

/**
 * Colour arithmetic between what a person (or a model) says and what the bridge takes.
 *
 * Hue speaks CIE 1931 xy for colour and mirek (one million over Kelvin) for white temperature.
 * Neither is a unit anybody asks for, so the lighting tools accept a hex colour and a Kelvin
 * temperature and these functions do the translation. Pure, so they are unit-tested.
 */

/** The bridge's own bounds for a Hue bulb: 2000 K candle to 6500 K daylight. */
export const MIREK_MIN = 153;
export const MIREK_MAX = 500;

export const KELVIN_MIN = 2000;
export const KELVIN_MAX = 6500;

/** `#ff8800`, `ff8800` and `#f80` all read; anything else is undefined. */
export function parseHexColor(value: string): { r: number; g: number; b: number } | undefined {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * sRGB to CIE xy, the way Philips documents it for their bulbs: undo the sRGB gamma, go through the
 * Wide RGB D65 matrix to XYZ, and normalise. No gamut clipping — the bridge clamps to the light's
 * own gamut, which differs per generation, and doing it here would only guess.
 *
 * Pure black has no chromaticity; it is answered as warm white so a caller asking for `#000000`
 * gets "the lamp, dim" rather than a division by zero.
 */
export function hexToXy(hex: string): HueXy | undefined {
  const rgb = parseHexColor(hex);

  if (!rgb) return undefined;

  const r = gammaExpand(rgb.r / 255);
  const g = gammaExpand(rgb.g / 255);
  const b = gammaExpand(rgb.b / 255);

  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;
  const sum = X + Y + Z;

  if (sum === 0) return { x: 0.4583, y: 0.4099 };

  return { x: round4(X / sum), y: round4(Y / sum) };
}

/** Kelvin to mirek, clamped to what a Hue bulb accepts. */
export function kelvinToMirek(kelvin: number): number {
  const clamped = Math.min(KELVIN_MAX, Math.max(KELVIN_MIN, kelvin));
  return Math.min(MIREK_MAX, Math.max(MIREK_MIN, Math.round(1_000_000 / clamped)));
}

/** Mirek to Kelvin, rounded to the nearest fifty: the precision anyone reads it at. */
export function mirekToKelvin(mirek: number): number {
  if (mirek <= 0) return KELVIN_MAX;
  return Math.round(1_000_000 / mirek / 50) * 50;
}

function gammaExpand(channel: number): number {
  return channel > 0.04045 ? Math.pow((channel + 0.055) / 1.055, 2.4) : channel / 12.92;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
