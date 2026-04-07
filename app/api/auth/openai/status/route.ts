/**
 * GET /api/auth/openai/status
 *
 * Returns the OAuth connection status without exposing tokens.
 */

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_EXPIRES_AT, COOKIE_ACCESS_TOKEN, isOAuthEnabled } from '@/lib/server/oauth-config';

export async function GET(req: NextRequest) {
  if (!isOAuthEnabled()) {
    return NextResponse.json({ enabled: false, connected: false });
  }

  const accessCookie = req.cookies.get(COOKIE_ACCESS_TOKEN)?.value;
  const expiresCookie = req.cookies.get(COOKIE_EXPIRES_AT)?.value;

  if (!accessCookie) {
    return NextResponse.json({ enabled: true, connected: false });
  }

  const expiresAt = expiresCookie ? parseInt(expiresCookie, 10) : null;
  const isExpired = expiresAt ? Date.now() > expiresAt : false;

  return NextResponse.json({
    enabled: true,
    connected: !isExpired,
    expiresAt: expiresAt || undefined,
  });
}
