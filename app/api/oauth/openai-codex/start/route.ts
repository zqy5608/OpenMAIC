import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError } from '@/lib/server/api-response';
import {
  buildOpenAICodexAuthorizationUrl,
  createOpenAICodexPkceState,
} from '@/lib/server/oauth/openai-codex';

const log = createLogger('OpenAICodexOAuthStart');

const COOKIE_NAME = 'openmaic-openai-codex-oauth';
const COOKIE_MAX_AGE_SECONDS = 10 * 60;

interface PendingOAuthState {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

function getRedirectUri(req: NextRequest): string {
  return new URL('/api/oauth/openai-codex/callback', req.nextUrl.origin).toString();
}

function encodePendingOAuthState(value: PendingOAuthState): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export async function GET(req: NextRequest) {
  try {
    const { state, codeVerifier, codeChallenge } = createOpenAICodexPkceState();
    const redirectUri = getRedirectUri(req);
    const authorizationUrl = buildOpenAICodexAuthorizationUrl({
      redirectUri,
      state,
      codeChallenge,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set({
      name: COOKIE_NAME,
      value: encodePendingOAuthState({
        state,
        codeVerifier,
        createdAt: Date.now(),
      }),
      httpOnly: true,
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    log.error('Failed to start OpenAI Codex OAuth flow:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to start OAuth flow',
    );
  }
}
