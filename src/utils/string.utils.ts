/**
 * Tests whether a string contains any non-ASCII characters.
 * Used to detect non-English text for source-priority conflict resolution
 * during deduplication merges.
 *
 * @param value - The string to test
 * @returns `true` if the string contains at least one character outside the ASCII range (0x00–0x7F)
 */
export function containsNonAscii(value: string): boolean {
  // The control-character range is the point of this test, not an accident.
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(value);
}
