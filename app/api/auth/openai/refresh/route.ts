/**
 * POST /api/auth/openai/refresh
 *
 * Refreshes the OpenAI OAuth access token using the refresh token.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  OPENAI_TOKEN_URL,
  OPENAI_OAUTH_CLIENT_ID,
  COOKIE_ACCESS_TOKEN,
  COOKIE_REFRESH_TOKEN,
  COOKIE_EXPIRES_AT,
  encryptToken,
  decryptToken,
  isOAuthEnabled,
} from '@/lib/server/oauth-config';

export async function POST(req: NextRequest) {
  if (!isOAuthEnabled()) {
    return NextResponse.json({ success: false, error: 'OAuth not enabled' }, { status: 503 });
  }

  const refreshCookie = req.cookies.get(COOKIE_REFRESH_TOKEN)?.value;
  if (!refreshCookie) {
    return NextResponse.json({ success: false, error: 'No refresh token' }, { status: 401 });
  }

  const refreshToken = decryptToken(refreshCookie);
  if (!refreshToken) {
    return NextResponse.json({ success: false, error: 'Invalid refresh token' }, { status: 401 });
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OPENAI_OAUTH_CLIENT_ID,
  });

  try {
    const res = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[OAuth Refresh] Failed:', res.status, errText);
      return NextResponse.json(
        { success: false, error: `Refresh failed (${res.status})` },
        { status: 401 },
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const expiresAt = Date.now() + data.expires_in * 1000;
    const isProduction = process.env.NODE_ENV === 'production';

    const response = NextResponse.json({ success: true, expiresAt });

    response.cookies.set(COOKIE_ACCESS_TOKEN, encryptToken(data.access_token), {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: data.expires_in,
    });

    // Update refresh token if a new one was issued
    if (data.refresh_token) {
      response.cookies.set(COOKIE_REFRESH_TOKEN, encryptToken(data.refresh_token), {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    response.cookies.set(COOKIE_EXPIRES_AT, String(expiresAt), {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error('[OAuth Refresh] Error:', err);
    return NextResponse.json({ success: false, error: 'Network error' }, { status: 500 });
  }
}
