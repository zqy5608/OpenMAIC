/**
 * GET /api/auth/openai/callback
 *
 * Handles the OAuth callback from OpenAI.
 * Validates state, exchanges authorization code for tokens,
 * stores encrypted tokens in httpOnly cookies, and closes the popup.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  OPENAI_TOKEN_URL,
  OPENAI_OAUTH_CLIENT_ID,
  COOKIE_PKCE_STATE,
  COOKIE_ACCESS_TOKEN,
  COOKIE_REFRESH_TOKEN,
  COOKIE_EXPIRES_AT,
  encryptToken,
  decryptToken,
  getRedirectUri,
  isOAuthEnabled,
} from '@/lib/server/oauth-config';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function GET(req: NextRequest) {
  if (!isOAuthEnabled()) {
    return new NextResponse('OAuth is not enabled', { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return returnHtml(
      `<p>Authorization failed: ${escapeHtml(error)}</p><p><a href="/">Return to app</a></p>`,
    );
  }

  if (!code || !state) {
    return returnHtml('<p>Missing authorization code or state parameter.</p>');
  }

  // Read and decrypt PKCE state cookie
  const pkceCookie = req.cookies.get(COOKIE_PKCE_STATE)?.value;
  if (!pkceCookie) {
    return returnHtml('<p>Session expired. Please try logging in again.</p>');
  }

  const pkceJson = decryptToken(pkceCookie);
  if (!pkceJson) {
    return returnHtml('<p>Invalid session. Please try logging in again.</p>');
  }

  let pkceData: { verifier: string; state: string };
  try {
    pkceData = JSON.parse(pkceJson);
  } catch {
    return returnHtml('<p>Corrupted session data. Please try again.</p>');
  }

  // Validate state to prevent CSRF
  if (pkceData.state !== state) {
    return returnHtml('<p>State mismatch. Possible CSRF attack. Please try again.</p>');
  }

  // Exchange authorization code for tokens
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code_verifier: pkceData.verifier,
  });

  let tokenData: TokenResponse;
  try {
    const tokenRes = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[OAuth Callback] Token exchange failed:', tokenRes.status, errText);
      return returnHtml(
        `<p>Token exchange failed (${tokenRes.status}). Please try again.</p>`,
      );
    }

    tokenData = (await tokenRes.json()) as TokenResponse;
  } catch (err) {
    console.error('[OAuth Callback] Token exchange error:', err);
    return returnHtml('<p>Failed to connect to OpenAI. Please try again.</p>');
  }

  if (!tokenData.access_token) {
    return returnHtml('<p>Invalid token response from OpenAI.</p>');
  }

  const expiresAt = Date.now() + tokenData.expires_in * 1000;
  const isProduction = process.env.NODE_ENV === 'production';

  // Build response HTML that notifies the opener and closes the popup
  const response = returnHtml(`
    <p>Login successful! This window will close automatically.</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'openai-oauth-success' }, '*');
      }
      window.close();
    </script>
  `);

  // Set encrypted token cookies
  response.cookies.set(COOKIE_ACCESS_TOKEN, encryptToken(tokenData.access_token), {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: tokenData.expires_in,
  });

  if (tokenData.refresh_token) {
    response.cookies.set(COOKIE_REFRESH_TOKEN, encryptToken(tokenData.refresh_token), {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
  }

  response.cookies.set(COOKIE_EXPIRES_AT, String(expiresAt), {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  // Clear PKCE state cookie
  response.cookies.delete(COOKIE_PKCE_STATE);

  return response;
}

function returnHtml(body: string): NextResponse {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OpenAI OAuth</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center">${body}</div>
</body>
</html>`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] || c;
  });
}
