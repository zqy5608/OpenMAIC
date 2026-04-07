import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import type { ProviderOAuthKind } from '@/lib/types/provider';

const log = createLogger('OAuthStore');

export interface OAuthProfile {
  provider: ProviderOAuthKind;
  accountId?: string;
  accountLabel?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  lastError?: string;
  managedBy?: 'openmaic' | 'codex-cli';
  updatedAt: string;
}

interface OAuthStoreFile {
  version: 1;
  profiles: Partial<Record<ProviderOAuthKind, OAuthProfile>>;
}

const DEFAULT_STORE_PATH = path.join(process.cwd(), 'data', 'oauth-profiles.json');
const LOCK_STALE_MS = 2 * 60 * 1000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;
let warnedAboutPlaintextStore = false;

function getStorePath(): string {
  const configured = process.env.OAUTH_STORE_FILE?.trim();
  if (!configured) return DEFAULT_STORE_PATH;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function ensureStoreDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLockPath(): string {
  return `${getStorePath()}.lock`;
}

function isStaleLock(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function acquireStoreLock(): Promise<() => void> {
  const lockPath = getLockPath();
  ensureStoreDir(lockPath);
  const startedAt = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}:${Date.now()}`, 'utf8');
      fs.closeSync(fd);

      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Another process may have already cleaned a stale lock.
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;

      if (isStaleLock(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch {
          // Race with another waiter; fall through to retry.
        }
      }

      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error('Timed out waiting for the OAuth token store lock.');
      }

      await sleep(LOCK_RETRY_MS);
    }
  }
}

function getEncryptionKey(): Buffer | null {
  const secret = process.env.AUTH_STORE_SECRET?.trim();
  if (!secret) {
    if (!warnedAboutPlaintextStore) {
      warnedAboutPlaintextStore = true;
      log.warn(
        'AUTH_STORE_SECRET is not configured; OAuth tokens will be stored in plaintext on disk.',
      );
    }
    return null;
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function encryptValue(value: string): string {
  const key = getEncryptionKey();
  if (!key) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    'enc',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

function decryptValue(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!value.startsWith('enc:')) return value;

  const key = getEncryptionKey();
  if (!key) {
    throw new Error('AUTH_STORE_SECRET is required to decrypt the OAuth store.');
  }

  const [, ivB64, authTagB64, dataB64] = value.split(':');
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Invalid encrypted OAuth token payload.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64url'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

function readStore(): OAuthStoreFile {
  const filePath = getStorePath();

  if (!fs.existsSync(filePath)) {
    return { version: 1, profiles: {} };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as OAuthStoreFile;
    const profiles = parsed.profiles || {};

    const normalizedProfiles = Object.fromEntries(
      Object.entries(profiles).map(([provider, profile]) => {
        if (!profile) return [provider, profile];

        return [
          provider,
          {
            ...profile,
            accessToken: decryptValue(profile.accessToken) || '',
            refreshToken: decryptValue(profile.refreshToken),
          },
        ];
      }),
    ) as OAuthStoreFile['profiles'];

    return {
      version: 1,
      profiles: normalizedProfiles,
    };
  } catch (error) {
    log.error('Failed to read OAuth store:', error);
    return { version: 1, profiles: {} };
  }
}

function writeStore(store: OAuthStoreFile): void {
  const filePath = getStorePath();
  ensureStoreDir(filePath);

  const persisted: OAuthStoreFile = {
    version: 1,
    profiles: Object.fromEntries(
      Object.entries(store.profiles).map(([provider, profile]) => {
        if (!profile) return [provider, profile];

        return [
          provider,
          {
            ...profile,
            accessToken: encryptValue(profile.accessToken),
            refreshToken: profile.refreshToken ? encryptValue(profile.refreshToken) : undefined,
          },
        ];
      }),
    ) as OAuthStoreFile['profiles'],
  };

  fs.writeFileSync(filePath, JSON.stringify(persisted, null, 2), 'utf8');
}

export function getOAuthProfile(provider: ProviderOAuthKind): OAuthProfile | null {
  return readStore().profiles[provider] || null;
}

export function saveOAuthProfile(profile: OAuthProfile): void {
  const store = readStore();
  store.profiles[profile.provider] = profile;
  writeStore(store);
}

export function deleteOAuthProfile(provider: ProviderOAuthKind): void {
  const store = readStore();
  delete store.profiles[provider];
  writeStore(store);
}

export async function withOAuthStoreLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const release = await acquireStoreLock();
  try {
    return await fn();
  } finally {
    release();
  }
}
