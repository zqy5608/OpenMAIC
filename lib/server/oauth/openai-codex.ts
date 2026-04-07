import crypto from 'crypto';
import type { ProviderOAuthKind } from '@/lib/types/provider';
import { createLogger } from '@/lib/logger';
import {
  deleteOAuthProfile,
  getOAuthProfile,
  saveOAuthProfile,
  withOAuthStoreLock,
  type OAuthProfile,
} from './store';
import {
  readOpenAICodexCliOAuthProfile,
  writeOpenAICodexCliOAuthProfile,
} from './openai-codex-cli-auth';
import {
  resolveCodexAccessTokenExpiry,
  resolveCodexAuthIdentity,
  trimNonEmptyString,
} from './openai-codex-identity';

const log = createLogger('OpenAICodexOAuth');

const OPENAI_CODEX_PROVIDER: ProviderOAuthKind = 'openai-codex';
const DEFAULT_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const DEFAULT_TOKEN_URL = 'https://auth.openai.com/oauth/token';
// AI SDK appends /responses for openai.responses(), so this resolves to
// https://chatgpt.com/backend-api/codex/responses at request time.
const DEFAULT_API_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_SCOPE = 'openid profile email offline_access';
const REFRESH_SKEW_MS = 60_000;

interface OpenAICodexTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface OpenAICodexOAuthStatus {
  connected: boolean;
  accountLabel?: string;
  expiresAt?: string;
  lastError?: string;
  credentialSource?: 'openmaic' | 'codex-cli';
}

interface OpenAICodexOAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  scope: string;
}

function getConfig(): OpenAICodexOAuthConfig {
  const clientId = process.env.OPENAI_CODEX_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('OPENAI_CODEX_OAUTH_CLIENT_ID is not configured.');
  }

  return {
    clientId,
    clientSecret: process.env.OPENAI_CODEX_OAUTH_CLIENT_SECRET?.trim() || undefined,
    authorizationUrl: process.env.OPENAI_CODEX_OAUTH_AUTH_URL?.trim() || DEFAULT_AUTH_URL,
    tokenUrl: process.env.OPENAI_CODEX_OAUTH_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL,
    scope: process.env.OPENAI_CODEX_OAUTH_SCOPE?.trim() || DEFAULT_SCOPE,
  };
}

function hasConfiguredClientId(): boolean {
  return !!process.env.OPENAI_CODEX_OAUTH_CLIENT_ID?.trim();
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function deriveAccountIdentity(data: OpenAICodexTokenResponse): {
  accountId?: string;
  accountLabel?: string;
} {
  const identity = resolveCodexAuthIdentity({
    accessToken: data.access_token,
    idToken: data.id_token,
  });

  return {
    accountId: identity.accountId,
    accountLabel: identity.profileName || identity.accountId,
  };
}

function buildExpiresAt(expiresIn?: number): string | undefined {
  if (!expiresIn || !Number.isFinite(expiresIn)) return undefined;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function normalizeTokenResponse(
  data: OpenAICodexTokenResponse,
  previous?: OAuthProfile | null,
): OAuthProfile {
  if (!data.access_token) {
    const errorMessage =
      data.error_description ||
      data.error ||
      'OAuth token response did not include an access token.';
    throw new Error(errorMessage);
  }

  const { accountId, accountLabel } = deriveAccountIdentity(data);

  return {
    provider: OPENAI_CODEX_PROVIDER,
    accountId: accountId || previous?.accountId,
    accountLabel: accountLabel || previous?.accountLabel,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || previous?.refreshToken,
    expiresAt:
      buildExpiresAt(data.expires_in) ||
      resolveCodexAccessTokenExpiry(data.access_token) ||
      previous?.expiresAt,
    lastError: undefined,
    managedBy: previous?.managedBy || 'openmaic',
    updatedAt: new Date().toISOString(),
  };
}

async function tokenRequest(params: URLSearchParams): Promise<OpenAICodexTokenResponse> {
  const config = getConfig();

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  const data = (await response.json().catch(() => ({}))) as OpenAICodexTokenResponse;
  if (!response.ok) {
    throw new Error(
      data.error_description || data.error || `OAuth token request failed (${response.status})`,
    );
  }

  return data;
}

export function getOpenAICodexBaseUrl(): string {
  return process.env.OPENAI_CODEX_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
}

export function createOpenAICodexPkceState(): {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = toBase64Url(crypto.randomBytes(24));
  const codeVerifier = toBase64Url(crypto.randomBytes(48));
  const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  return { state, codeVerifier, codeChallenge };
}

export function buildOpenAICodexAuthorizationUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const config = getConfig();
  const url = new URL(config.authorizationUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('state', params.state);

  return url.toString();
}

export async function exchangeOpenAICodexCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<OAuthProfile> {
  const config = getConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }

  const tokenData = await tokenRequest(body);
  return normalizeTokenResponse(tokenData);
}

async function refreshOpenAICodexProfile(profile: OAuthProfile): Promise<OAuthProfile> {
  if (!profile.refreshToken) {
    throw new Error('OAuth session has expired and no refresh token is available.');
  }

  if (profile.managedBy === 'codex-cli' && !hasConfiguredClientId()) {
    throw new Error(
      'Codex CLI OAuth token is expired. Re-run `codex login` or configure OPENAI_CODEX_OAUTH_CLIENT_ID so OpenMAIC can refresh it.',
    );
  }

  const config = getConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: profile.refreshToken,
  });

  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }

  const tokenData = await tokenRequest(body);
  const nextProfile = normalizeTokenResponse(tokenData, profile);

  if (profile.managedBy === 'codex-cli') {
    if (!writeOpenAICodexCliOAuthProfile(nextProfile)) {
      log.warn('Failed to persist refreshed OpenAI Codex token back to Codex CLI auth.json.');
    }
    return nextProfile;
  }

  saveOAuthProfile(nextProfile);
  return nextProfile;
}

function shouldRefresh(profile: OAuthProfile): boolean {
  if (!profile.expiresAt) return false;
  const expiresAt = new Date(profile.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt - Date.now() <= REFRESH_SKEW_MS;
}

export async function saveOpenAICodexProfile(profile: OAuthProfile): Promise<void> {
  saveOAuthProfile({
    ...profile,
    provider: OPENAI_CODEX_PROVIDER,
    managedBy: profile.managedBy || 'openmaic',
    updatedAt: new Date().toISOString(),
    lastError: undefined,
  });
}

export function clearOpenAICodexProfile(): void {
  deleteOAuthProfile(OPENAI_CODEX_PROVIDER);
}

function resolveOpenAICodexProfile(): OAuthProfile | null {
  const storedProfile = getOAuthProfile(OPENAI_CODEX_PROVIDER);
  if (storedProfile?.managedBy === 'codex-cli') {
    return readOpenAICodexCliOAuthProfile() || storedProfile;
  }
  return storedProfile || readOpenAICodexCliOAuthProfile();
}

export function getOpenAICodexOAuthStatus(): OpenAICodexOAuthStatus {
  const profile = resolveOpenAICodexProfile();
  if (!profile) {
    return { connected: false };
  }

  return {
    connected: true,
    accountLabel: profile.accountLabel,
    expiresAt: profile.expiresAt,
    lastError: profile.lastError,
    credentialSource: profile.managedBy || 'openmaic',
  };
}

export async function getValidOpenAICodexAccessToken(): Promise<string> {
  const profile = resolveOpenAICodexProfile();
  if (!profile?.accessToken) {
    throw new Error('OpenAI Codex is not connected. Connect OAuth in Settings first.');
  }

  if (!shouldRefresh(profile)) {
    return profile.accessToken;
  }

  return await withOAuthStoreLock(async () => {
    const lockedProfile = resolveOpenAICodexProfile();
    if (!lockedProfile?.accessToken) {
      throw new Error('OpenAI Codex is not connected. Connect OAuth in Settings first.');
    }

    if (!shouldRefresh(lockedProfile)) {
      return lockedProfile.accessToken;
    }

    try {
      const nextProfile = await refreshOpenAICodexProfile(lockedProfile);
      return nextProfile.accessToken;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to refresh OpenAI Codex OAuth token.';

      if (
        /extract\s+accountid\s+from\s+token/i.test(message) &&
        trimNonEmptyString(lockedProfile.accessToken)
      ) {
        return lockedProfile.accessToken;
      }

      log.error('Failed to refresh OpenAI Codex OAuth token:', error);
      if (lockedProfile.managedBy !== 'codex-cli') {
        saveOAuthProfile({
          ...lockedProfile,
          lastError: message,
          updatedAt: new Date().toISOString(),
        });
      }
      throw error;
    }
  });
}
