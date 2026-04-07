import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';
import { callLLM } from '@/lib/ai/llm';
const log = createLogger('Verify Model');

export async function POST(req: NextRequest) {
  let model: string | undefined;
  try {
    const body = await req.json();
    const { apiKey, baseUrl, providerType, requiresApiKey } = body;
    model = body.model;

    if (!model) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }

    // Parse model string and resolve server-side fallback
    let resolvedModel: Awaited<ReturnType<typeof resolveModel>>;
    try {
      resolvedModel = await resolveModel({
        modelString: model,
        apiKey: apiKey || '',
        baseUrl: baseUrl || undefined,
        providerType,
        requiresApiKey,
      });
    } catch (error) {
      return apiError(
        'INVALID_REQUEST',
        401,
        error instanceof Error ? error.message : String(error),
      );
    }
    const languageModel = resolvedModel.model;

    // Send a minimal test message
    const { text } = await callLLM(
      {
        model: languageModel,
        system: 'You are a connection test endpoint. Reply with exactly OK.',
        prompt: 'Say "OK" if you can hear me.',
      },
      'verify-model',
    );

    return apiSuccess({
      message: 'Connection successful',
      response: text,
    });
  } catch (error) {
    const apiErrorDetails = error as {
      requestBodyValues?: unknown;
      responseBody?: unknown;
      statusCode?: unknown;
      url?: unknown;
    };

    log.error(`Model verification failed [model="${model ?? 'unknown'}"]:`, {
      message: error instanceof Error ? error.message : String(error),
      requestBodyValues: apiErrorDetails.requestBodyValues,
      responseBody: apiErrorDetails.responseBody,
      statusCode: apiErrorDetails.statusCode,
      url: apiErrorDetails.url,
    });

    let errorMessage = 'Connection failed';
    if (error instanceof Error) {
      // Parse common error messages
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        errorMessage = 'API key is invalid or expired';
      } else if (error.message.includes('404') || error.message.includes('not found')) {
        errorMessage = 'Model not found or API endpoint error';
      } else if (error.message.includes('429')) {
        errorMessage = 'API rate limit exceeded, please try again later';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Cannot connect to API server, please check the Base URL';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Connection timed out, please check your network';
      } else {
        errorMessage = error.message;
      }
    }

    return apiError('INTERNAL_ERROR', 500, errorMessage);
  }
}
