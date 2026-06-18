/**
 * Tavily Web Search Integration
 *
 * Uses raw REST API via proxyFetch for reliable proxy support.
 * Tavily search endpoint: POST https://api.tavily.com/search
 */

import { proxyFetch } from '@/lib/server/proxy-fetch';
import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';
import { buildWebSearchEndpointUrl } from './utils';

const TAVILY_API_BASE_URL = 'https://api.tavily.com';
const TAVILY_SEARCH_PATH = '/search';

const TAVILY_MAX_QUERY_LENGTH = 400;

function buildTavilySearchUrl(baseUrl?: string): string {
  return buildWebSearchEndpointUrl(baseUrl?.trim() || TAVILY_API_BASE_URL, TAVILY_SEARCH_PATH);
}

/**
 * Search the web using Tavily REST API and return structured results.
 */
export async function searchWithTavily(params: {
  query: string;
  apiKey: string;
  baseUrl?: string;
  maxResults?: number;
}): Promise<WebSearchResult> {
  const { query, apiKey, baseUrl, maxResults = 5 } = params;

  // Tavily rejects queries over 400 characters with a 400 error
  const truncatedQuery = query.slice(0, TAVILY_MAX_QUERY_LENGTH);

  const res = await proxyFetch(buildTavilySearchUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: truncatedQuery,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: 'basic',
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Tavily API error (${res.status}): ${errorText || res.statusText}`);
  }

  const data = (await res.json()) as {
    answer?: string;
    query: string;
    response_time: number;
    results: Array<{
      title: string;
      url: string;
      content: string;
      score: number;
    }>;
  };

  const sources: WebSearchSource[] = (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));

  return {
    answer: data.answer || '',
    sources,
    query: data.query,
    responseTime: data.response_time,
  };
}
