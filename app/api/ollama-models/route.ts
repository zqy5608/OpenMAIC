/**
 * GET /api/ollama-models
 *
 * Fetches the list of locally installed Ollama models by querying
 * the Ollama API at /api/tags. Returns model IDs that can be used
 * with the Ollama provider.
 *
 * Query params:
 *   baseUrl - Optional custom Ollama base URL (defaults to http://localhost:11434)
 */

import { NextRequest, NextResponse } from 'next/server';

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // The Ollama native API is at the root, not /v1
  const baseUrl = searchParams.get('baseUrl') || 'http://localhost:11434';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Ollama returned ${res.status}`, models: [] },
        { status: 502 },
      );
    }

    const data = (await res.json()) as OllamaTagsResponse;

    const models = (data.models || []).map((m) => ({
      id: m.name,
      name: formatModelName(m.name, m.details),
      parameterSize: m.details?.parameter_size,
      family: m.details?.family,
      quantization: m.details?.quantization_level,
    }));

    return NextResponse.json({ models });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Connection timed out. Is Ollama running?'
        : 'Cannot connect to Ollama. Make sure it is running locally.';

    return NextResponse.json({ error: message, models: [] }, { status: 503 });
  }
}

/**
 * Format a human-readable model name from Ollama model info.
 * e.g. "llama3.3:latest" + {parameter_size: "70B"} => "Llama 3.3 70B"
 */
function formatModelName(
  name: string,
  details?: { parameter_size?: string; family?: string },
): string {
  // Remove the tag suffix (e.g. ":latest")
  const base = name.split(':')[0];
  const size = details?.parameter_size || '';

  // Capitalize and clean up
  const formatted = base
    .replace(/([a-z])(\d)/g, '$1 $2') // "llama3" -> "llama 3"
    .replace(/(\d)([a-z])/gi, '$1 $2') // "3b" -> "3 b"
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()); // Title case

  return size ? `${formatted} (${size})` : formatted;
}
