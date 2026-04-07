import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { clearOpenAICodexProfile } from '@/lib/server/oauth/openai-codex';

const log = createLogger('OpenAICodexOAuthLogout');

export async function POST() {
  try {
    clearOpenAICodexProfile();
    return apiSuccess({ connected: false });
  } catch (error) {
    log.error('Failed to clear OpenAI Codex OAuth session:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to disconnect OAuth session',
    );
  }
}
