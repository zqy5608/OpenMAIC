/**
 * Credential Resolution with OAuth Fallback
 *
 * Wraps the existing resolveApiKey with an additional OAuth token check
 * for the OpenAI provider. Priority: client key > server key > OAuth token.
 */

import type { NextRequest } from 'next/server';
import { resolveApiKey } from '@/lib/server/provider-config';
import { getOAuthAccessToken } from '@/lib/server/oauth-tokens';

/**
 * Resolve the effective API key for a provider, with OAuth fallback for OpenAI.
 *
 * @param req - The incoming request (needed to read OAuth cookies)
 * @param providerId - The provider ID (e.g. 'openai', 'anthropic')
 * @param clientApiKey - Optional client-supplied API key
 * @returns The resolved API key string (may be empty if nothing is configured)
 */
export function resolveEffectiveApiKey(
  req: NextRequest,
  providerId: string,
  clientApiKey?: string,
): string {
  // First try the standard resolution: client key > server key
  const standardKey = resolveApiKey(providerId, clientApiKey);
  if (standardKey) return standardKey;

  // For OpenAI, fall back to OAuth token from cookies
  if (providerId === 'openai') {
    const oauthToken = getOAuthAccessToken(req);
    if (oauthToken) return oauthToken;
  }

  return '';
}
