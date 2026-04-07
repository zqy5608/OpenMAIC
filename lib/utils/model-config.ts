import { useSettingsStore } from '@/lib/store/settings';
import { useOAuthStatusStore } from '@/lib/store/oauth-status';

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const { providerId, modelId, providersConfig } = useSettingsStore.getState();
  const modelString = `${providerId}:${modelId}`;

  // Get current provider's config
  const providerConfig = providersConfig[providerId];

  // Check OAuth connection for OpenAI
  const isOAuthConnected =
    providerId === 'openai' ? useOAuthStatusStore.getState().isConnected : false;

  return {
    providerId,
    modelId,
    modelString,
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
    isOAuthConnected,
  };
}
