/**
 * OpenAI OAuth Configuration & Crypto Helpers
 *
 * Implements PKCE (S256) OAuth flow against OpenAI's auth endpoints.
 * Tokens are encrypted before storing in httpOnly cookies.
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// OAuth Endpoints & Client Config
// ---------------------------------------------------------------------------

export const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const OPENAI_OAUTH_CLIENT_ID =
  process.env.OPENAI_OAUTH_CLIENT_ID || 'Iv23li2UEweVNyaJa9i5';
export const OPENAI_OAUTH_SCOPE = 'openai.public';

/** Base URL for constructing the redirect_uri */
function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

export function getRedirectUri(): string {
  return `${getBaseUrl()}/api/auth/openai/callback`;
}

// ---------------------------------------------------------------------------
// Cookie Names
// ---------------------------------------------------------------------------

export const COOKIE_ACCESS_TOKEN = 'openai_oauth_access';
export const COOKIE_REFRESH_TOKEN = 'openai_oauth_refresh';
export const COOKIE_EXPIRES_AT = 'openai_oauth_expires';
export const COOKIE_PKCE_STATE = 'openai_oauth_pkce';

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

/** Generate a random code_verifier (43-128 chars, base64url) */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString('base64url');
}

/** Generate S256 code_challenge from code_verifier */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Generate a random state parameter for CSRF protection */
export function generateState(): string {
  return crypto.randomBytes(24).toString('base64url');
}

// ---------------------------------------------------------------------------
// Token Encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

function getCookieSecret(): Buffer {
  const secret = process.env.OAUTH_COOKIE_SECRET;
  if (!secret) {
    throw new Error('OAUTH_COOKIE_SECRET environment variable is required for OpenAI OAuth');
  }
  // Derive a 32-byte key from the secret string
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a token string for secure cookie storage.
 * Format: iv:authTag:ciphertext (all hex-encoded)
 */
export function encryptToken(token: string): string {
  const key = getCookieSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a token string from cookie storage.
 * Returns null if decryption fails (tampered or wrong key).
 */
export function decryptToken(encrypted: string): string | null {
  try {
    const key = getCookieSecret();
    const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) return null;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Feature Gate
// ---------------------------------------------------------------------------

/** Check if OAuth feature is available (OAUTH_COOKIE_SECRET must be set) */
export function isOAuthEnabled(): boolean {
  return !!process.env.OAUTH_COOKIE_SECRET;
}
