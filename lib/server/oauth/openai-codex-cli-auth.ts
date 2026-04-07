import fs from 'fs';
import os from 'os';
import path from 'path';
import type { OAuthProfile } from './store';
import {
  resolveCodexAccessTokenExpiry,
  resolveCodexAuthIdentity,
  trimNonEmptyString,
} from './openai-codex-identity';

type CodexCliAuthFile = {
  auth_mode?: unknown;
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
};

const PROVIDER_ID = 'openai-codex';

function resolveHomePath(configured: string | undefined): string {
  const home = os.homedir();
  if (!configured) return path.join(home, '.codex');
  if (configured === '~') return home;
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return path.join(home, configured.slice(2));
  }
  return path.resolve(configured);
}

function isCodexCliReuseEnabled(): boolean {
  const configured = process.env.OPENAI_CODEX_REUSE_CODEX_CLI_AUTH?.trim().toLowerCase();
  return !configured || !['0', 'false', 'no', 'off'].includes(configured);
}

export function resolveCodexCliAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHomePath(trimNonEmptyString(env.CODEX_HOME)), 'auth.json');
}

function readCodexCliAuthFile(env: NodeJS.ProcessEnv = process.env): CodexCliAuthFile | null {
  if (!isCodexCliReuseEnabled()) return null;

  try {
    const raw = fs.readFileSync(resolveCodexCliAuthPath(env), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CodexCliAuthFile) : null;
  } catch {
    return null;
  }
}

export function readOpenAICodexCliOAuthProfile(
  env: NodeJS.ProcessEnv = process.env,
): OAuthProfile | null {
  const authFile = readCodexCliAuthFile(env);
  if (!authFile || authFile.auth_mode !== 'chatgpt') return null;

  const access = trimNonEmptyString(authFile.tokens?.access_token);
  const refresh = trimNonEmptyString(authFile.tokens?.refresh_token);
  if (!access || !refresh) return null;

  const identity = resolveCodexAuthIdentity({ accessToken: access });
  const accountId = trimNonEmptyString(authFile.tokens?.account_id) ?? identity.accountId;

  return {
    provider: PROVIDER_ID,
    accessToken: access,
    refreshToken: refresh,
    ...(accountId ? { accountId } : {}),
    ...(identity.profileName
      ? { accountLabel: identity.profileName }
      : accountId
        ? { accountLabel: accountId }
        : {}),
    expiresAt: resolveCodexAccessTokenExpiry(access),
    managedBy: 'codex-cli',
    updatedAt: new Date().toISOString(),
  };
}

export function writeOpenAICodexCliOAuthProfile(
  profile: OAuthProfile,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isCodexCliReuseEnabled()) return false;

  try {
    const authPath = resolveCodexCliAuthPath(env);
    const parsed = readCodexCliAuthFile(env) ?? {};
    if (parsed.auth_mode !== 'chatgpt') return false;

    const nextAuthFile: CodexCliAuthFile = {
      ...parsed,
      auth_mode: 'chatgpt',
      tokens: {
        ...parsed.tokens,
        access_token: profile.accessToken,
        refresh_token: profile.refreshToken,
        account_id: profile.accountId,
      },
    };

    fs.writeFileSync(authPath, `${JSON.stringify(nextAuthFile, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
