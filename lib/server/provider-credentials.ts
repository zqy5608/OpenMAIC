import { getProvider } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/types/provider';
import { resolveApiKey } from '@/lib/server/provider-config';
import { getValidOpenAICodexAccessToken } from '@/lib/server/oauth/openai-codex';

export interface ResolvedProviderCredential {
  kind: 'apiKey' | 'oauthAccessToken';
  token: string;
}

export async function resolveProviderCredential(params: {
  providerId: ProviderId;
  clientKey?: string;
  allowServerFallback?: boolean;
}): Promise<ResolvedProviderCredential> {
  const { providerId, clientKey, allowServerFallback = true } = params;

  if (clientKey) {
    return {
      kind: 'apiKey',
      token: clientKey,
    };
  }

  if (!allowServerFallback) {
    return {
      kind: 'apiKey',
      token: '',
    };
  }

  const provider = getProvider(providerId);
  if (provider?.oauthProviderId === 'openai-codex') {
    return {
      kind: 'oauthAccessToken',
      token: await getValidOpenAICodexAccessToken(),
    };
  }

  return {
    kind: 'apiKey',
    token: resolveApiKey(providerId),
  };
}
