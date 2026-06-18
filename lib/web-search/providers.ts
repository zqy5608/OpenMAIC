import type { WebSearchResult } from '@/lib/types/web-search';
import { searchWithBrave } from './brave';
import { searchWithTavily } from './tavily';
import type { WebSearchProviderId } from './types';

export async function searchWeb(params: {
  providerId: WebSearchProviderId;
  query: string;
  apiKey: string;
  baseUrl?: string;
  maxResults?: number;
}): Promise<WebSearchResult> {
  const { providerId, ...rest } = params;

  switch (providerId) {
    case 'brave':
      return searchWithBrave(rest);
    case 'tavily':
    default:
      return searchWithTavily(rest);
  }
}
