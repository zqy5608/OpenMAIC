/**
 * GET /api/auth/openai/login
 *
 * Initiates the OpenAI OAuth PKCE flow.
 * Generates PKCE verifier/challenge + state, stores in a short-lived httpOnly cookie,
 * and redirects to OpenAI's authorization endpoint.
 */

import { NextResponse } from 'next/server';
import {
  OPENAI_AUTHORIZE_URL,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_SCOPE,
  COOKIE_PKCE_STATE,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  encryptToken,
  getRedirectUri,
  isOAuthEnabled,
} from '@/lib/server/oauth-config';

export async function GET() {
  if (!isOAuthEnabled()) {
    return NextResponse.json(
      { error: 'OAuth is not enabled. Set OAUTH_COOKIE_SECRET in environment.' },
      { status: 503 },
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  // Store PKCE verifier + state in an encrypted httpOnly cookie
  const pkceData = JSON.stringify({ verifier, state });
  const encrypted = encryptToken(pkceData);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_OAUTH_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    scope: OPENAI_OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  const authorizeUrl = `${OPENAI_AUTHORIZE_URL}?${params.toString()}`;

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(COOKIE_PKCE_STATE, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  return response;
}
