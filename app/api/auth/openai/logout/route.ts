/**
 * POST /api/auth/openai/logout
 *
 * Clears all OAuth cookies, disconnecting the user.
 */

import { NextResponse } from 'next/server';
import {
  COOKIE_ACCESS_TOKEN,
  COOKIE_REFRESH_TOKEN,
  COOKIE_EXPIRES_AT,
} from '@/lib/server/oauth-config';

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.delete(COOKIE_ACCESS_TOKEN);
  response.cookies.delete(COOKIE_REFRESH_TOKEN);
  response.cookies.delete(COOKIE_EXPIRES_AT);

  return response;
}
