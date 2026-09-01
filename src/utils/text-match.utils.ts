/**
 * Fuzzy comparison of free-text music metadata, shared by every catalog matcher.
 *
 * Extracted from the Qobuz matcher when YouTube arrived: both have to decide whether a catalog hit
 * is the recording the caller asked for, and two implementations of "close enough" drifting apart
 * would mean the same track scoring differently depending on which provider found it.
 */

/**
 * Folds a title/artist/album into a comparable form: accents stripped, case
 * flattened, apostrophes removed (so `Don't` and `Dont` collide) and every
 * remaining non-alphanumeric run turned into a single space.
 *
 * Catalog metadata is inconsistent about all four — `Push It To The Limit`,
 * `Push it to the limit` and `Push It to the Limit (Remastered)` all describe
 * the same recording.
 */
export function normalizeForMatch(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['’ʼ]/g, '')
    // Split letter/digit runs so a tokenised title lines up with a spaced one.
    // Qobuz lists "Code 4" where the file tag says "Code4"; sharing no token,
    // that pair scored a flat zero and the track looked like a different song.
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Token-set similarity in [0, 1] between two free-text fields.
 *
 * Uses the better of Dice coefficient and containment: containment is what
 * catches the common case where the catalog title carries extra qualifiers the
 * caller did not type (`Push It to the Limit (From "Scarface")`). It is
 * discounted so a genuinely exact match always outranks a subset match.
 */
export function similarity(left: string | null | undefined, right: string | null | undefined): number {
  const normalizedLeft = normalizeForMatch(left);
  const normalizedRight = normalizeForMatch(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftTokens = new Set(normalizedLeft.split(' '));
  const rightTokens = new Set(normalizedRight.split(' '));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;

  if (intersection === 0) {
    return 0;
  }

  const dice = (2 * intersection) / (leftTokens.size + rightTokens.size);
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);

  return Math.max(dice, containment * 0.9);
}
