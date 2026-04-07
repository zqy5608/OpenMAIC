/**
 * Server-side OAuth Token Resolution
 *
 * Reads and decrypts the OpenAI OAuth access token from httpOnly cookies.
 * Does NOT auto-refresh — the client handles proactive refresh.
 */

import type { NextRequest } from 'next/server';
import {
  COOKIE_ACCESS_TOKEN,
  COOKIE_EXPIRES_AT,
  decryptToken,
  isOAuthEnabled,
} from '@/lib/server/oauth-config';

/**
 * Read the OpenAI OAuth access token from request cookies.
 * Returns the decrypted token if valid and not expired, otherwise null.
 */
export function getOAuthAccessToken(req: NextRequest): string | null {
  if (!isOAuthEnabled()) return null;

  const accessCookie = req.cookies.get(COOKIE_ACCESS_TOKEN)?.value;
  if (!accessCookie) return null;

  // Check expiry
  const expiresCookie = req.cookies.get(COOKIE_EXPIRES_AT)?.value;
  if (expiresCookie) {
    const expiresAt = parseInt(expiresCookie, 10);
    if (Date.now() > expiresAt) return null;
  }

  return decryptToken(accessCookie);
}
