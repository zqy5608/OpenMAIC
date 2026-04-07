import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  exchangeOpenAICodexCode,
  saveOpenAICodexProfile,
} from '@/lib/server/oauth/openai-codex';

const log = createLogger('OpenAICodexOAuthCallback');

const COOKIE_NAME = 'openmaic-openai-codex-oauth';
const COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

interface PendingOAuthState {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

function getRedirectUri(req: NextRequest): string {
  return new URL('/api/oauth/openai-codex/callback', req.nextUrl.origin).toString();
}

function decodePendingOAuthState(value: string | undefined): PendingOAuthState | null {
  if (!value) return null;

  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as PendingOAuthState;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderCallbackPage(params: { success: boolean; error?: string }): string {
  const payload = JSON.stringify({
    source: 'openmaic-oauth',
    provider: 'openai-codex',
    success: params.success,
    error: params.error,
  }).replaceAll('<', '\\u003c');
  const title = params.success ? 'OpenAI Codex connected' : 'OpenAI Codex connection failed';
  const description = params.success
    ? 'You can close this window and return to OpenMAIC.'
    : params.error || 'OAuth authorization failed.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e2e8f0;
        font: 16px/1.5 ui-sans-serif, system-ui, sans-serif;
      }
      main {
        width: min(100%, 28rem);
        padding: 2rem;
        border-radius: 1rem;
        background: rgba(15, 23, 42, 0.92);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45);
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.25rem;
      }
      p {
        margin: 0;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
    </main>
    <script>
      const payload = ${payload};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, window.location.origin);
      }
      setTimeout(() => {
        if (window.opener && !window.opener.closed) {
          window.close();
        } else {
          window.location.replace('/');
        }
      }, 250);
    </script>
  </body>
</html>`;
}

function buildHtmlResponse(params: { success: boolean; error?: string }, status = 200): NextResponse {
  const response = new NextResponse(renderCallbackPage(params), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

  response.cookies.delete(COOKIE_NAME);
  return response;
}

export async function GET(req: NextRequest) {
  const pending = decodePendingOAuthState(req.cookies.get(COOKIE_NAME)?.value);

  try {
    if (!pending) {
      return buildHtmlResponse(
        {
          success: false,
          error: 'OAuth session state is missing. Start the connection flow again.',
        },
        400,
      );
    }

    if (Date.now() - pending.createdAt > COOKIE_MAX_AGE_MS) {
      return buildHtmlResponse(
        {
          success: false,
          error: 'OAuth session expired. Start the connection flow again.',
        },
        400,
      );
    }

    const upstreamError =
      req.nextUrl.searchParams.get('error_description') || req.nextUrl.searchParams.get('error');
    if (upstreamError) {
      return buildHtmlResponse({ success: false, error: upstreamError }, 400);
    }

    const state = req.nextUrl.searchParams.get('state');
    const code = req.nextUrl.searchParams.get('code');

    if (!state || !code) {
      return buildHtmlResponse(
        {
          success: false,
          error: 'OAuth callback is missing the authorization code.',
        },
        400,
      );
    }

    if (state !== pending.state) {
      return buildHtmlResponse(
        {
          success: false,
          error: 'OAuth state mismatch. Start the connection flow again.',
        },
        400,
      );
    }

    const profile = await exchangeOpenAICodexCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: getRedirectUri(req),
    });

    await saveOpenAICodexProfile(profile);
    return buildHtmlResponse({ success: true });
  } catch (error) {
    log.error('Failed to finish OpenAI Codex OAuth flow:', error);
    return buildHtmlResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to finish OAuth flow',
      },
      500,
    );
  }
}
