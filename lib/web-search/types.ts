/**
 * Web Search Provider Type Definitions
 */

/**
 * Web Search Provider IDs
 */
export type WebSearchProviderId = 'tavily' | 'brave';

/**
 * Web Search Provider Configuration
 */
export interface WebSearchProviderConfig {
  id: WebSearchProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  defaultSearchPath?: string;
  icon?: string;
}

export function isWebSearchProviderId(value: string | undefined): value is WebSearchProviderId {
  return value === 'tavily' || value === 'brave';
}
