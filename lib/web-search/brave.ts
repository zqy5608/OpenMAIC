/**
 * Brave Search LLM Context integration
 *
 * Uses Brave's LLM Context endpoint to fetch agent-friendly grounding content.
 * Docs: https://api-dashboard.search.brave.com/documentation/services/llm-context
 */

import { proxyFetch } from '@/lib/server/proxy-fetch';
import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';
import { buildWebSearchEndpointUrl } from './utils';

const BRAVE_API_BASE_URL = 'https://api.search.brave.com';
const BRAVE_LLM_CONTEXT_PATH = '/res/v1/llm/context';
const BRAVE_MAX_QUERY_LENGTH = 400;

interface BraveGroundingItem {
  url?: string;
  title?: string;
  snippets?: string[];
}

interface BraveContextResponse {
  grounding?: {
    generic?: BraveGroundingItem[];
    poi?: BraveGroundingItem | null;
    map?: BraveGroundingItem[];
  };
  sources?: Record<
    string,
    {
      title?: string;
      hostname?: string;
    }
  >;
}

function buildBraveContextUrl(baseUrl?: string): string {
  return buildWebSearchEndpointUrl(baseUrl?.trim() || BRAVE_API_BASE_URL, BRAVE_LLM_CONTEXT_PATH);
}

function mergeGroundingResults(data: BraveContextResponse): BraveGroundingItem[] {
  return [
    ...(data.grounding?.generic || []),
    ...(data.grounding?.poi ? [data.grounding.poi] : []),
    ...(data.grounding?.map || []),
  ];
}

function buildSourceContent(item: BraveGroundingItem): string {
  return (item.snippets || [])
    .map((snippet) => snippet.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Search the web using Brave LLM Context and return structured results.
 */
export async function searchWithBrave(params: {
  query: string;
  apiKey: string;
  baseUrl?: string;
  maxResults?: number;
}): Promise<WebSearchResult> {
  const { query, apiKey, baseUrl, maxResults = 5 } = params;
  const startedAt = Date.now();

  const truncatedQuery = query.slice(0, BRAVE_MAX_QUERY_LENGTH);

  const res = await proxyFetch(buildBraveContextUrl(baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
      'X-Subscription-Token': apiKey,
    },
    body: JSON.stringify({
      q: truncatedQuery,
      count: maxResults,
      maximum_number_of_urls: maxResults,
      maximum_number_of_snippets: Math.max(maxResults * 4, maxResults),
      maximum_number_of_snippets_per_url: 4,
      maximum_number_of_tokens: 2048,
      maximum_number_of_tokens_per_url: 512,
      context_threshold_mode: 'balanced',
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Brave Search API error (${res.status}): ${errorText || res.statusText}`);
  }

  const data = (await res.json()) as BraveContextResponse;
  const dedupedResults = Array.from(
    new Map(
      mergeGroundingResults(data)
        .filter((item): item is BraveGroundingItem & { url: string } => !!item.url)
        .map((item) => [item.url, item]),
    ).values(),
  ).slice(0, maxResults);

  const sources: WebSearchSource[] = dedupedResults.map((item, index) => {
    const metadata = data.sources?.[item.url];
    const title = item.title?.trim() || metadata?.title?.trim() || metadata?.hostname || item.url;
    const content = buildSourceContent(item) || title;
    const normalizedScore =
      dedupedResults.length <= 1 ? 1 : Number((1 - index / dedupedResults.length).toFixed(3));

    return {
      title,
      url: item.url,
      content,
      score: normalizedScore,
    };
  });

  return {
    answer: '',
    sources,
    query: truncatedQuery,
    responseTime: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
  };
}
