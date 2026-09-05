import { getErrorMessage } from '../../utils/error.utils';

/**
 * The shape `spotify-web-api-node` gives every failed request: a `WebapiError`
 * (an `Error` subclass) carrying the HTTP response alongside the message. The
 * SDK does not export the class, so it is recognised structurally.
 */
interface SpotifyWebapiError extends Error {
  statusCode: number;
  body: unknown;
  headers: Record<string, string> | undefined;
}

function isSpotifyWebapiError(error: unknown): error is SpotifyWebapiError {
  return error instanceof Error && typeof (error as Partial<SpotifyWebapiError>).statusCode === 'number' && 'body' in error;
}

/**
 * Whether a failure is Spotify saying "not now" rather than "no": a 429, which a Development
 * Mode app hits after a dozen calls in quick succession. Callers that would otherwise record the
 * failure as permanent — the negentropy ledger — use this to defer instead.
 */
export function isSpotifyRateLimited(error: unknown): boolean {
  return isSpotifyWebapiError(error) && error.statusCode === 429;
}

/** Bodies too long for a log line are cut here; the head is where the reason sits. */
const BODY_PREVIEW_LENGTH = 300;

// superagent parses a text/plain or HTML response into an empty object and keeps
// the text on a field the SDK does not copy, so an empty body here usually means
// a non-JSON reply. Spotify's "user is not registered for this application"
// 403 is one of those; fetch the endpoint directly to read it.
const NO_BODY = '(no JSON body; call the endpoint directly to read the text reply)';

function renderBody(body: unknown): string {
  if (body === undefined || body === null || body === '') return NO_BODY;
  const rendered = typeof body === 'string' ? body : JSON.stringify(body);
  if (rendered === '{}') return NO_BODY;
  return rendered.length > BODY_PREVIEW_LENGTH ? rendered.slice(0, BODY_PREVIEW_LENGTH) + '…' : rendered;
}

/**
 * Renders a caught Spotify SDK failure with the details a log line needs.
 *
 * `spotify-web-api-node` builds a readable message only for the three error
 * bodies Spotify documents. Anything else — a 429 with an empty body, an HTML
 * 5xx page, a body without an `error` key — goes through a fallback that hands
 * the *body object* to `Error` as the message, which stringifies to
 * `[object Object]`. Reading `error.message` off those is therefore useless;
 * the status code and body on the error are the only signal, so they are put
 * in front. `Retry-After` is included when present, since a 429 is unreadable
 * without it.
 *
 * Non-SDK errors fall back to {@link getErrorMessage}.
 */
export function describeSpotifyError(error: unknown): string {
  if (!isSpotifyWebapiError(error)) {
    return getErrorMessage(error);
  }

  const parts: string[] = [`HTTP ${error.statusCode}`];

  // The fallback branch puts the body object into `message`; keep the message
  // only when it is a sentence the SDK actually composed.
  if (error.message && error.message !== '[object Object]') {
    parts.push(error.message.replace(/\s*\n\s*/g, ' '));
  } else {
    parts.push(renderBody(error.body));
  }

  const retryAfter = error.headers?.['retry-after'];
  if (retryAfter !== undefined) {
    parts.push(`(Retry-After: ${retryAfter}s)`);
  }

  return parts.join(' ');
}
