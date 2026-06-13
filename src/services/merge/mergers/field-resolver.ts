import { Source } from '../../../schemas/source.schema.js';
import { containsNonAscii } from '../../../utils/string.utils.js';

/** Fields where the 'file' source always wins */
const GENRE_FIELDS = new Set(['genre', 'primary_genres']);

/** Fields where the non-English (non-ASCII) detection rule applies */
const TEXT_FIELDS = new Set([
  'title',
  'artist',
  'album_artist',
  'composer',
  'subtitle',
  'description',
  'short_intro',
  'biography',
]);

/**
 * Determines whether a value should be considered empty for merge purposes.
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Resolves a metadata field conflict between a primary and duplicate entity
 * based on source-priority rules.
 *
 * Priority rules:
 * 1. Genre fields → prefer value from 'file' source
 * 2. Text fields → prefer value containing non-ASCII characters (non-English);
 *    otherwise fall through to qobuz preference
 * 3. All other fields → prefer value from 'qobuz' source
 * 4. Fallback → if only one value is non-empty, use that; otherwise keep primary
 */
export function resolveFieldValue<T>(
  fieldName: string,
  primaryValue: T,
  duplicateValue: T,
  primarySources: Source[],
  duplicateSources: Source[],
): T {
  const primaryEmpty = isEmptyValue(primaryValue);
  const duplicateEmpty = isEmptyValue(duplicateValue);

  // If both empty, keep primary
  if (primaryEmpty && duplicateEmpty) return primaryValue;
  // If only one has a value, use it
  if (primaryEmpty) return duplicateValue;
  if (duplicateEmpty) return primaryValue;

  const primaryHasQobuz = primarySources.some((s) => s.name === 'qobuz');
  const duplicateHasQobuz = duplicateSources.some((s) => s.name === 'qobuz');
  const primaryHasFile = primarySources.some((s) => s.name === 'file');
  const duplicateHasFile = duplicateSources.some((s) => s.name === 'file');

  // Genre: prefer file source
  if (GENRE_FIELDS.has(fieldName)) {
    if (primaryHasFile) return primaryValue;
    if (duplicateHasFile) return duplicateValue;
    // Neither has file — fall through to default qobuz preference
  }

  // Text fields: non-ASCII wins
  if (TEXT_FIELDS.has(fieldName)) {
    const pNonAscii =
      typeof primaryValue === 'string' && containsNonAscii(primaryValue);
    const dNonAscii =
      typeof duplicateValue === 'string' && containsNonAscii(duplicateValue);

    if (pNonAscii && !dNonAscii) return primaryValue;
    if (dNonAscii && !pNonAscii) return duplicateValue;
    // Both ASCII or both non-ASCII — fall through to default
  }

  // Default: prefer qobuz
  if (primaryHasQobuz) return primaryValue;
  if (duplicateHasQobuz) return duplicateValue;

  // Ultimate fallback: keep primary
  return primaryValue;
}
