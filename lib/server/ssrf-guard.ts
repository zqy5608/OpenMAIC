/**
 * SSRF (Server-Side Request Forgery) protection utilities.
 *
 * Validates URLs to prevent requests to internal/private network addresses.
 * Used by any API route that fetches a user-supplied URL server-side.
 */

/** Check if hostname is in the 172.16.0.0 - 172.31.255.255 private range */
function isPrivate172(hostname: string): boolean {
  if (!hostname.startsWith('172.')) return false;
  const second = parseInt(hostname.split('.')[1], 10);
  return second >= 16 && second <= 31;
}

/** Provider IDs that are explicitly allowed to use local/private URLs */
const LOCAL_ALLOWED_PROVIDERS = new Set(['ollama']);

/**
 * Validate a URL against SSRF attacks.
 * Returns null if the URL is safe, or an error message string if blocked.
 *
 * @param url - The URL to validate
 * @param providerId - Optional provider ID. Some providers (e.g. Ollama) are
 *                     explicitly allowed to use localhost/private URLs.
 */
export function validateUrlForSSRF(url: string, providerId?: string): string | null {
  if (providerId && LOCAL_ALLOWED_PROVIDERS.has(providerId)) {
    // Skip SSRF check for providers that are designed to run locally
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL';
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Only HTTP(S) URLs are allowed';
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    isPrivate172(hostname) ||
    hostname.endsWith('.local') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80')
  ) {
    return 'Local/private network URLs are not allowed';
  }

  return null;
}
