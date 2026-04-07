import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getOpenAICodexOAuthStatus } from '@/lib/server/oauth/openai-codex';

const log = createLogger('OpenAICodexOAuthStatus');

export async function GET() {
  try {
    return apiSuccess({ ...getOpenAICodexOAuthStatus() });
  } catch (error) {
    log.error('Failed to read OpenAI Codex OAuth status:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to read OAuth status',
    );
  }
}
