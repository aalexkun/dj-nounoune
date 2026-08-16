/** Loopback, link-local and RFC 1918 hosts — never worth a request, and not ours to probe. */
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

/**
 * A model asked for an artwork URL will happily invent a well-formed one, so nothing it returns can be
 * trusted without a look. Confirms the address is a public https image that actually answers, and never
 * throws: an unreachable or fabricated URL is simply not an image.
 */
export async function isReachableImageUrl(url: string, timeoutMs = 5000): Promise<boolean> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (PRIVATE_HOST.test(parsed.hostname)) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed.toString(), { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (!response.ok) return false;
    return (response.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
