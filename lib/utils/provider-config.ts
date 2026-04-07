import type { ProviderSettings } from '@/lib/types/settings';

type ProviderSettingsLike = Partial<ProviderSettings> | null | undefined;

export function isProviderAuthConfigured(config: ProviderSettingsLike): boolean {
  if (!config) return false;

  if (config.authMode === 'oauth') {
    return !!config.oauthConnected;
  }

  return !config.requiresApiKey || !!config.apiKey || !!config.isServerConfigured;
}

export function isProviderReadyForUse(config: ProviderSettingsLike): boolean {
  if (!config) return false;

  const hasModels = Array.isArray(config.models) && config.models.length > 0;
  const hasEndpoint = !!(config.baseUrl || config.defaultBaseUrl || config.serverBaseUrl);

  return isProviderAuthConfigured(config) && hasModels && hasEndpoint;
}

export function getProviderSetupDescriptionKey(config: ProviderSettingsLike): string {
  return config?.authMode === 'oauth' ? 'settings.oauthConnectionRequired' : 'settings.apiKeyDesc';
}
