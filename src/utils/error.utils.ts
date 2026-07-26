/**
 * Extracts a human-readable message from a caught value.
 *
 * Catch variables are typed `unknown` (`useUnknownInCatchVariables`) because a
 * throw site can produce anything — a rejected driver promise, a string, or a
 * plain object. Reading `.message` off those directly yields `undefined` in the
 * log rather than the actual failure.
 *
 * @param error - The caught value, of unknown shape
 * @returns `error.message` for `Error` instances, otherwise a string rendering of the value
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
