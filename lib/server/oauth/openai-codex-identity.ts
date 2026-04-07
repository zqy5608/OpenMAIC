type CodexJwtPayload = {
  exp?: unknown;
  iss?: unknown;
  sub?: unknown;
  account_id?: unknown;
  email?: unknown;
  preferred_username?: unknown;
  name?: unknown;
  'https://api.openai.com/profile'?: {
    email?: unknown;
  };
  'https://api.openai.com/auth'?: {
    chatgpt_account_user_id?: unknown;
    chatgpt_user_id?: unknown;
    user_id?: unknown;
  };
};

export function trimNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeFutureEpochSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

export function decodeCodexJwtPayload(token: string | undefined): CodexJwtPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? (parsed as CodexJwtPayload) : null;
  } catch {
    return null;
  }
}

export function resolveCodexStableSubject(payload: CodexJwtPayload | null): string | undefined {
  const auth = payload?.['https://api.openai.com/auth'];
  const accountUserId = trimNonEmptyString(auth?.chatgpt_account_user_id);
  if (accountUserId) return accountUserId;

  const userId = trimNonEmptyString(auth?.chatgpt_user_id) ?? trimNonEmptyString(auth?.user_id);
  if (userId) return userId;

  const iss = trimNonEmptyString(payload?.iss);
  const sub = trimNonEmptyString(payload?.sub);
  if (iss && sub) return `${iss}|${sub}`;
  return sub;
}

export function resolveCodexAccessTokenExpiry(accessToken: string): string | undefined {
  const payload = decodeCodexJwtPayload(accessToken);
  const exp = normalizeFutureEpochSeconds(payload?.exp);
  return exp ? new Date(exp * 1000).toISOString() : undefined;
}

export function resolveCodexAuthIdentity(params: {
  accessToken?: string;
  idToken?: string;
  email?: string | null;
}): {
  accountId?: string;
  email?: string;
  profileName?: string;
} {
  const accessPayload = decodeCodexJwtPayload(params.accessToken);
  const idPayload = decodeCodexJwtPayload(params.idToken);
  const payload = accessPayload || idPayload;
  const auth = payload?.['https://api.openai.com/auth'];
  const idAuth = idPayload?.['https://api.openai.com/auth'];

  const accountId =
    trimNonEmptyString(payload?.account_id) ??
    trimNonEmptyString(auth?.chatgpt_account_user_id) ??
    trimNonEmptyString(auth?.chatgpt_user_id) ??
    trimNonEmptyString(auth?.user_id) ??
    trimNonEmptyString(idPayload?.account_id) ??
    trimNonEmptyString(idAuth?.chatgpt_account_user_id) ??
    trimNonEmptyString(idAuth?.chatgpt_user_id) ??
    trimNonEmptyString(idAuth?.user_id);

  const email =
    trimNonEmptyString(payload?.['https://api.openai.com/profile']?.email) ??
    trimNonEmptyString(payload?.email) ??
    trimNonEmptyString(idPayload?.['https://api.openai.com/profile']?.email) ??
    trimNonEmptyString(idPayload?.email) ??
    trimNonEmptyString(params.email);

  if (email) {
    return { accountId, email, profileName: email };
  }

  const explicitName =
    trimNonEmptyString(payload?.preferred_username) ??
    trimNonEmptyString(payload?.name) ??
    trimNonEmptyString(idPayload?.preferred_username) ??
    trimNonEmptyString(idPayload?.name);
  if (explicitName) {
    return { accountId, profileName: explicitName };
  }

  const stableSubject = resolveCodexStableSubject(payload);
  if (!stableSubject) {
    return accountId ? { accountId, profileName: accountId } : {};
  }

  return {
    accountId,
    profileName: `id-${Buffer.from(stableSubject).toString('base64url')}`,
  };
}
