/**
 * TTS (Text-to-Speech) Provider Implementation
 *
 * Factory pattern for routing TTS requests to appropriate provider implementations.
 * Follows the same architecture as lib/ai/providers.ts for consistency.
 *
 * Currently Supported Providers:
 * - OpenAI TTS: https://platform.openai.com/docs/guides/text-to-speech
 * - Azure TTS: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech
 * - GLM TTS: https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-tts
 * - Qwen TTS: https://bailian.console.aliyun.com/
 * - Qwen3 Local TTS: self-hosted qwen_tts HTTP service or Gradio demo
 * - MiniMax TTS: https://platform.minimaxi.com/docs/api-reference/speech-t2a-http
 * - Doubao TTS: https://www.volcengine.com/docs/6561/1257543
 * - ElevenLabs TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 * - Browser Native: Web Speech API (client-side only)
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * 1. Add provider ID to TTSProviderId in lib/audio/types.ts
 *    Example: | 'elevenlabs-tts'
 *
 * 2. Add provider configuration to lib/audio/constants.ts
 *    Example:
 *    'elevenlabs-tts': {
 *      id: 'elevenlabs-tts',
 *      name: 'ElevenLabs',
 *      requiresApiKey: true,
 *      defaultBaseUrl: 'https://api.elevenlabs.io/v1',
 *      icon: '/logos/elevenlabs.svg',
 *      voices: [...],
 *      supportedFormats: ['mp3', 'pcm'],
 *      speedRange: { min: 0.5, max: 2.0, default: 1.0 }
 *    }
 *
 * 3. Implement provider function in this file
 *    Pattern: async function generateXxxTTS(config, text): Promise<TTSGenerationResult>
 *    - Validate config and build API request
 *    - Handle API authentication (apiKey, headers)
 *    - Convert provider-specific parameters (voice, speed, format)
 *    - Return { audio: Uint8Array, format: string }
 *
 *    Example:
 *    async function generateElevenLabsTTS(
 *      config: TTSModelConfig,
 *      text: string
 *    ): Promise<TTSGenerationResult> {
 *      const baseUrl = config.baseUrl || TTS_PROVIDERS['elevenlabs-tts'].defaultBaseUrl;
 *
 *      const response = await fetch(`${baseUrl}/text-to-speech/${config.voice}`, {
 *        method: 'POST',
 *        headers: {
 *          'xi-api-key': config.apiKey!,
 *          'Content-Type': 'application/json',
 *        },
 *        body: JSON.stringify({
 *          text,
 *          model_id: 'eleven_multilingual_v2',
 *          voice_settings: {
 *            stability: 0.5,
 *            similarity_boost: 0.75,
 *          }
 *        }),
 *      });
 *
 *      if (!response.ok) {
 *        throw new Error(`ElevenLabs TTS API error: ${response.statusText}`);
 *      }
 *
 *      const arrayBuffer = await response.arrayBuffer();
 *      return {
 *        audio: new Uint8Array(arrayBuffer),
 *        format: 'mp3',
 *      };
 *    }
 *
 * 4. Add case to generateTTS() switch statement
 *    case 'elevenlabs-tts':
 *      return await generateElevenLabsTTS(config, text);
 *
 * 5. Add i18n translations in lib/i18n.ts
 *    providerElevenLabsTTS: { zh: 'ElevenLabs TTS', en: 'ElevenLabs TTS' }
 *
 * Error Handling Patterns:
 * - Always validate API key if requiresApiKey is true
 * - Throw descriptive errors for API failures
 * - Include response.statusText or error messages from API
 * - For client-only providers (browser-native), throw error directing to client-side usage
 *
 * API Call Patterns:
 * - Direct API: Use fetch with appropriate headers and body format (recommended for better encoding support)
 * - SSML: For Azure-like providers requiring SSML markup
 * - URL-based: For providers returning audio URL (download in second step)
 */

import type { TTSModelConfig } from './types';
import { TTS_PROVIDERS } from './constants';

/**
 * Result of TTS generation
 */
export interface TTSGenerationResult {
  audio: Uint8Array;
  format: string;
}

/**
 * Thrown when a TTS provider returns a rate-limit / concurrency-quota error.
 * Allows downstream consumers to distinguish rate-limit errors from other TTS failures.
 *
 * TODO: The API route currently catches all errors uniformly as GENERATION_FAILED.
 * This class enables future retry/backoff logic without changing the throw sites.
 */
export class TTSRateLimitError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'TTSRateLimitError';
  }
}

/**
 * Generate speech using specified TTS provider
 */
export async function generateTTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const provider = TTS_PROVIDERS[config.providerId];
  if (!provider) {
    throw new Error(`Unknown TTS provider: ${config.providerId}`);
  }

  // Validate API key if required
  if (provider.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for TTS provider: ${config.providerId}`);
  }

  switch (config.providerId) {
    case 'openai-tts':
      return await generateOpenAITTS(config, text);

    case 'azure-tts':
      return await generateAzureTTS(config, text);

    case 'glm-tts':
      return await generateGLMTTS(config, text);

    case 'qwen-tts':
      return await generateQwenTTS(config, text);

    case 'qwen3-local-tts':
      return await generateQwen3LocalTTS(config, text);

    case 'minimax-tts':
      return await generateMiniMaxTTS(config, text);
    case 'doubao-tts':
      return await generateDoubaoTTS(config, text);
    case 'elevenlabs-tts':
      return await generateElevenLabsTTS(config, text);

    case 'browser-native-tts':
      throw new Error(
        'Browser Native TTS must be handled client-side using Web Speech API. This provider cannot be used on the server.',
      );

    default:
      throw new Error(`Unsupported TTS provider: ${config.providerId}`);
  }
}

/**
 * OpenAI TTS implementation (direct API call with explicit UTF-8 encoding)
 */
async function generateOpenAITTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const baseUrl = config.baseUrl || TTS_PROVIDERS['openai-tts'].defaultBaseUrl;

  // Use gpt-4o-mini-tts for best quality and intelligent realtime applications
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: config.modelId || 'gpt-4o-mini-tts',
      input: text,
      voice: config.voice,
      speed: config.speed || 1.0,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`OpenAI TTS API error: ${error.error?.message || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audio: new Uint8Array(arrayBuffer),
    format: 'mp3',
  };
}

/**
 * Azure TTS implementation (direct API call with SSML)
 */
async function generateAzureTTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const baseUrl = config.baseUrl || TTS_PROVIDERS['azure-tts'].defaultBaseUrl;

  // Build SSML
  const rate = config.speed ? `${((config.speed - 1) * 100).toFixed(0)}%` : '0%';
  const ssml = `
    <speak version='1.0' xml:lang='zh-CN'>
      <voice xml:lang='zh-CN' name='${config.voice}'>
        <prosody rate='${rate}'>${escapeXml(text)}</prosody>
      </voice>
    </speak>
  `.trim();

  const response = await fetch(`${baseUrl}/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey!,
      'Content-Type': 'application/ssml+xml; charset=utf-8',
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
    },
    body: ssml,
  });

  if (!response.ok) {
    throw new Error(`Azure TTS API error: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audio: new Uint8Array(arrayBuffer),
    format: 'mp3',
  };
}

/**
 * GLM TTS implementation (GLM API)
 */
async function generateGLMTTS(config: TTSModelConfig, text: string): Promise<TTSGenerationResult> {
  const baseUrl = config.baseUrl || TTS_PROVIDERS['glm-tts'].defaultBaseUrl;

  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: config.modelId || 'glm-tts',
      input: text,
      voice: config.voice,
      speed: config.speed || 1.0,
      volume: 1.0,
      response_format: 'wav',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    let errorMessage = `GLM TTS API error: ${errorText}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = `GLM TTS API error: ${errorJson.error.message} (code: ${errorJson.error.code})`;
      }
    } catch {
      // If not JSON, use the text as is
    }
    throw new Error(errorMessage);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audio: new Uint8Array(arrayBuffer),
    format: 'wav',
  };
}

/**
 * Qwen TTS implementation (DashScope API - Qwen3 TTS Flash)
 */
async function generateQwenTTS(config: TTSModelConfig, text: string): Promise<TTSGenerationResult> {
  const baseUrl = config.baseUrl || TTS_PROVIDERS['qwen-tts'].defaultBaseUrl;

  // Calculate speed: Qwen3 uses rate parameter from -500 to 500
  // speed 1.0 = rate 0, speed 2.0 = rate 500, speed 0.5 = rate -250
  const rate = Math.round(((config.speed || 1.0) - 1.0) * 500);

  const response = await fetch(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: config.modelId || 'qwen3-tts-flash',
      input: {
        text,
        voice: config.voice,
        language_type: 'Chinese', // Default to Chinese, can be made configurable
      },
      parameters: {
        rate, // Speech rate from -500 to 500
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Qwen TTS API error: ${errorText}`);
  }

  const data = await response.json();

  // Check for audio URL in response
  if (!data.output?.audio?.url) {
    throw new Error(`Qwen TTS error: No audio URL in response. Response: ${JSON.stringify(data)}`);
  }

  // Download audio from URL
  const audioUrl = data.output.audio.url;
  const audioResponse = await fetch(audioUrl);

  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio from URL: ${audioResponse.statusText}`);
  }

  const arrayBuffer = await audioResponse.arrayBuffer();

  return {
    audio: new Uint8Array(arrayBuffer),
    format: 'wav', // Qwen3 TTS returns WAV format
  };
}

interface GradioComponentConfig {
  id: number;
  type?: string;
  props?: {
    label?: string;
    value?: unknown;
    choices?: unknown[];
  };
}

interface GradioDependencyConfig {
  id?: number;
  api_name?: string | false | null;
  inputs?: number[];
  outputs?: number[];
}

interface GradioAppConfig {
  components?: GradioComponentConfig[];
  dependencies?: GradioDependencyConfig[];
}

const QWEN3_LOCAL_TTS_TIMEOUT_MS = 120_000;
const QWEN3_LOCAL_HEALTH_TIMEOUT_MS = 3_000;
const QWEN3_LOCAL_SESSION_HASH = 'openmaic-qwen3-local-tts';

/**
 * Qwen3 Local TTS implementation for a local qwen_tts HTTP service or Gradio demo.
 *
 * Prefer scripts/qwen3_tts_http_service.py when using the qwen_tts Python API directly. The
 * adapter also supports the package's Gradio demo by calling the named endpoints
 * (`run_instruct` for CustomVoice or `run_voice_design` for VoiceDesign).
 */
async function generateQwen3LocalTTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const baseUrl = normalizeBaseUrl(
    config.baseUrl || TTS_PROVIDERS['qwen3-local-tts'].defaultBaseUrl || 'http://127.0.0.1:8000',
  );

  if (await isQwen3LocalHttpService(baseUrl)) {
    return await generateQwen3LocalJsonTTS(baseUrl, config, text);
  }

  let gradioError: unknown;
  try {
    return await generateQwen3LocalGradioTTS(baseUrl, config, text);
  } catch (error) {
    gradioError = error;
  }

  try {
    return await generateQwen3LocalJsonTTS(baseUrl, config, text);
  } catch (jsonError) {
    throw new Error(
      `Qwen3 Local TTS request failed. Make sure the local qwen_tts HTTP service or qwen-tts-demo is running and the Base URL is correct. Gradio error: ${stringifyError(
        gradioError,
      )}. JSON fallback error: ${stringifyError(jsonError)}.`,
    );
  }
}

async function isQwen3LocalHttpService(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(QWEN3_LOCAL_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const health = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return !!(
      health &&
      health.ok === true &&
      typeof health.model === 'string' &&
      typeof health.defaultSpeaker === 'string'
    );
  } catch {
    return false;
  }
}

async function generateQwen3LocalGradioTTS(
  baseUrl: string,
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const configResponse = await fetch(`${baseUrl}/config`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(QWEN3_LOCAL_TTS_TIMEOUT_MS),
  });
  if (!configResponse.ok) {
    throw new Error(`Gradio config request failed: ${configResponse.statusText}`);
  }

  const appConfig = (await configResponse.json()) as GradioAppConfig;
  const endpoint = selectQwen3LocalGradioEndpoint(appConfig, config, text);
  const result = await callQwen3LocalGradioEndpoint(baseUrl, endpoint.apiName, endpoint.data);

  return await resolveQwen3LocalAudioResult(result, baseUrl);
}

async function generateQwen3LocalJsonTTS(
  baseUrl: string,
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      text,
      input: text,
      voice: config.voice || 'vivian',
      speaker: config.voice || 'vivian',
      model: config.modelId || 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      speed: config.speed || 1.0,
      language: getProviderStringOption(config, 'language') || 'chinese',
      format: config.format || 'wav',
    }),
    signal: AbortSignal.timeout(QWEN3_LOCAL_TTS_TIMEOUT_MS),
  });

  const contentType = response.headers.get('content-type') || '';
  if (response.ok && contentType.startsWith('audio/')) {
    const audio = new Uint8Array(await response.arrayBuffer());
    return { audio, format: inferAudioFormat(baseUrl, contentType) };
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `JSON endpoint error (${response.status}): ${responseText || response.statusText}`,
    );
  }

  const data = JSON.parse(responseText);
  return await resolveQwen3LocalAudioResult(data, baseUrl);
}

function selectQwen3LocalGradioEndpoint(
  appConfig: GradioAppConfig,
  config: TTSModelConfig,
  text: string,
): { apiName: string; data: unknown[] } {
  const dependencies = (appConfig.dependencies || []).filter(
    (dependency) => dependency.api_name !== false,
  );
  const customVoiceEndpoint = findGradioDependency(dependencies, appConfig, 'run_instruct');
  const voiceDesignEndpoint = findGradioDependency(dependencies, appConfig, 'run_voice_design');
  const languageEndpoint = customVoiceEndpoint || voiceDesignEndpoint;

  const language = getPreferredGradioInput(appConfig, languageEndpoint, 1, 'Auto', config, [
    'language',
  ]);
  const speaker = getPreferredGradioInput(
    appConfig,
    customVoiceEndpoint,
    2,
    config.voice || 'vivian',
  );
  const instruct = getProviderStringOption(config, 'instruct') || '';
  const voiceDesignPrompt =
    getProviderStringOption(config, 'voiceDesign') ||
    getProviderStringOption(config, 'voiceDesignPrompt') ||
    getProviderStringOption(config, 'instruct') ||
    'Speak in a clear, natural classroom narration voice.';

  if (customVoiceEndpoint) {
    return {
      apiName: normalizeApiName(customVoiceEndpoint.api_name),
      data: [text, language, speaker, instruct],
    };
  }

  if (voiceDesignEndpoint) {
    return {
      apiName: normalizeApiName(voiceDesignEndpoint.api_name),
      data: [text, language, voiceDesignPrompt],
    };
  }

  const likelyCustomVoice = dependencies.find((dependency) => {
    const labels = getDependencyInputLabels(appConfig, dependency).join(' ').toLowerCase();
    return labels.includes('text') && labels.includes('speaker');
  });
  if (likelyCustomVoice?.api_name) {
    return {
      apiName: normalizeApiName(likelyCustomVoice.api_name),
      data: [text, language, speaker, instruct],
    };
  }

  const likelyVoiceDesign = dependencies.find((dependency) => {
    const labels = getDependencyInputLabels(appConfig, dependency).join(' ').toLowerCase();
    return labels.includes('text') && labels.includes('voice design');
  });
  if (likelyVoiceDesign?.api_name) {
    return {
      apiName: normalizeApiName(likelyVoiceDesign.api_name),
      data: [text, language, voiceDesignPrompt],
    };
  }

  throw new Error(
    'Could not find a supported Qwen3 TTS Gradio endpoint. Use a CustomVoice or VoiceDesign checkpoint.',
  );
}

function findGradioDependency(
  dependencies: GradioDependencyConfig[],
  appConfig: GradioAppConfig,
  apiName: string,
): GradioDependencyConfig | undefined {
  return dependencies.find((dependency) => {
    if (dependency.api_name === apiName) return true;
    const labels = getDependencyInputLabels(appConfig, dependency).join(' ').toLowerCase();
    return labels.includes(apiName.replace(/_/g, ' '));
  });
}

function getDependencyInputLabels(
  appConfig: GradioAppConfig,
  dependency: GradioDependencyConfig,
): string[] {
  return (dependency.inputs || [])
    .map((id) => appConfig.components?.find((component) => component.id === id)?.props?.label)
    .filter((label): label is string => !!label);
}

function getPreferredGradioInput(
  appConfig: GradioAppConfig,
  dependency: GradioDependencyConfig | undefined,
  inputIndex: number,
  preferredValue: string,
  config?: TTSModelConfig,
  optionKeys: string[] = [],
): string {
  const optionValue = optionKeys
    .map((key) => (config ? getProviderStringOption(config, key) : undefined))
    .find(Boolean);
  const preferred = optionValue || preferredValue;
  const inputId = dependency?.inputs?.[inputIndex];
  const component = appConfig.components?.find((item) => item.id === inputId);
  const choices = extractGradioChoices(component);

  if (choices.length === 0) return preferred;
  if (choices.includes(preferred)) return preferred;

  const titled = titleCase(preferred);
  if (choices.includes(titled)) return titled;

  const defaultValue =
    typeof component?.props?.value === 'string' ? component.props.value : undefined;
  if (defaultValue && choices.includes(defaultValue)) return defaultValue;

  return choices[0] || preferred;
}

function extractGradioChoices(component: GradioComponentConfig | undefined): string[] {
  const rawChoices = component?.props?.choices;
  if (!Array.isArray(rawChoices)) return [];

  return rawChoices
    .map((choice) => {
      if (typeof choice === 'string') return choice;
      if (Array.isArray(choice)) {
        const label = choice[0];
        return typeof label === 'string' ? label : undefined;
      }
      if (choice && typeof choice === 'object') {
        const record = choice as Record<string, unknown>;
        if (typeof record.label === 'string') return record.label;
        if (typeof record.value === 'string') return record.value;
      }
      return undefined;
    })
    .filter((choice): choice is string => !!choice);
}

async function callQwen3LocalGradioEndpoint(
  baseUrl: string,
  apiName: string,
  data: unknown[],
): Promise<unknown> {
  const directResponse = await fetch(`${baseUrl}/run/${apiName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      data,
      session_hash: QWEN3_LOCAL_SESSION_HASH,
    }),
    signal: AbortSignal.timeout(QWEN3_LOCAL_TTS_TIMEOUT_MS),
  });

  if (directResponse.ok) {
    return await directResponse.json();
  }

  const directError = await directResponse.text().catch(() => directResponse.statusText);
  const queuedResponse = await fetch(`${baseUrl}/call/${apiName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(QWEN3_LOCAL_TTS_TIMEOUT_MS),
  });

  if (!queuedResponse.ok) {
    const queuedError = await queuedResponse.text().catch(() => queuedResponse.statusText);
    throw new Error(
      `Gradio endpoint /${apiName} failed. Direct: ${directError}. Queue: ${queuedError}.`,
    );
  }

  const queuedData = (await queuedResponse.json()) as { event_id?: string };
  if (!queuedData.event_id) {
    throw new Error(`Gradio queue did not return an event_id: ${JSON.stringify(queuedData)}`);
  }

  const resultResponse = await fetch(`${baseUrl}/call/${apiName}/${queuedData.event_id}`, {
    headers: { Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(QWEN3_LOCAL_TTS_TIMEOUT_MS),
  });

  if (!resultResponse.ok) {
    const resultError = await resultResponse.text().catch(() => resultResponse.statusText);
    throw new Error(`Gradio queue result failed: ${resultError}`);
  }

  return parseGradioSseResult(await resultResponse.text());
}

function parseGradioSseResult(text: string): { data: unknown } {
  const events = text.split(/\r?\n\r?\n/).filter(Boolean);
  for (const eventText of events) {
    const eventName = eventText.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const dataText = eventText.match(/^data:\s*(.+)$/m)?.[1];
    if (!dataText || eventName === 'heartbeat') continue;

    const parsedData = JSON.parse(dataText);
    if (eventName === 'complete') return { data: parsedData };
    if (eventName === 'error') {
      throw new Error(typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData));
    }
  }

  throw new Error(`No completed Gradio result found in SSE response: ${text.slice(0, 500)}`);
}

async function resolveQwen3LocalAudioResult(
  result: unknown,
  baseUrl: string,
): Promise<TTSGenerationResult> {
  const resultRecord =
    result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const outputs = Array.isArray(resultRecord.data)
    ? resultRecord.data
    : Array.isArray(result)
      ? result
      : [result];
  const status = outputs.find((item) => typeof item === 'string') as string | undefined;
  const audioPayload = outputs.find((item) => looksLikeAudioPayload(item));

  if (!audioPayload) {
    const maybeAudio =
      resultRecord.audio || resultRecord.base64 || resultRecord.url || resultRecord.audio_url;
    if (maybeAudio) return await resolveQwen3LocalAudioPayload(maybeAudio, baseUrl);

    throw new Error(status || `Qwen3 Local TTS returned no audio: ${JSON.stringify(result)}`);
  }

  return await resolveQwen3LocalAudioPayload(audioPayload, baseUrl);
}

function looksLikeAudioPayload(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'string') return looksLikeAudioString(value);
  if (Array.isArray(value)) return value.length >= 2 && typeof value[0] === 'number';
  if (typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return !!(
    record.url ||
    record.path ||
    record.name ||
    record.audio ||
    record.base64 ||
    record.audio_url ||
    record.data
  );
}

function looksLikeAudioString(value: string): boolean {
  return (
    value.startsWith('data:audio/') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('.wav') ||
    value.includes('.mp3') ||
    (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.replace(/\s/g, '').length > 64)
  );
}

async function resolveQwen3LocalAudioPayload(
  payload: unknown,
  baseUrl: string,
): Promise<TTSGenerationResult> {
  if (Array.isArray(payload) && typeof payload[0] === 'number') {
    return {
      audio: encodeWavFromSamples(payload[1], payload[0]),
      format: 'wav',
    };
  }

  if (typeof payload === 'string') {
    return await resolveQwen3LocalAudioString(payload, baseUrl);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(`Unsupported Qwen3 Local TTS audio payload: ${JSON.stringify(payload)}`);
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data) && typeof record.sampling_rate === 'number') {
    return { audio: encodeWavFromSamples(record.data, record.sampling_rate), format: 'wav' };
  }
  if (record.data && typeof record.data === 'object') {
    return await resolveQwen3LocalAudioPayload(record.data, baseUrl);
  }
  if (typeof record.data === 'string') {
    return decodeBase64Audio(record.data, 'wav');
  }
  if (typeof record.audio === 'string') {
    return decodeBase64Audio(record.audio, 'wav');
  }
  if (typeof record.base64 === 'string') {
    return decodeBase64Audio(record.base64, 'wav');
  }

  const url = typeof record.url === 'string' ? record.url : undefined;
  const audioUrl = typeof record.audio_url === 'string' ? record.audio_url : undefined;
  const path = typeof record.path === 'string' ? record.path : undefined;
  const name = typeof record.name === 'string' ? record.name : undefined;
  if (url) return await downloadQwen3LocalAudio(resolvePossiblyRelativeUrl(baseUrl, url));
  if (audioUrl) return await downloadQwen3LocalAudio(resolvePossiblyRelativeUrl(baseUrl, audioUrl));
  if (path) return await downloadQwen3LocalAudio(resolveGradioFileUrl(baseUrl, path));
  if (name) return await downloadQwen3LocalAudio(resolveGradioFileUrl(baseUrl, name));

  throw new Error(`Unsupported Qwen3 Local TTS audio payload: ${JSON.stringify(payload)}`);
}

async function resolveQwen3LocalAudioString(
  value: string,
  baseUrl: string,
): Promise<TTSGenerationResult> {
  if (value.startsWith('data:audio/')) {
    const match = value.match(/^data:audio\/([^;,]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid audio data URL from Qwen3 Local TTS');
    return decodeBase64Audio(match[2], normalizeFormat(match[1]));
  }

  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
    return await downloadQwen3LocalAudio(resolvePossiblyRelativeUrl(baseUrl, value));
  }

  if (
    value.includes('\\') ||
    value.includes('/') ||
    value.includes('.wav') ||
    value.includes('.mp3')
  ) {
    return await downloadQwen3LocalAudio(resolveGradioFileUrl(baseUrl, value));
  }

  return decodeBase64Audio(value, 'wav');
}

async function downloadQwen3LocalAudio(url: string): Promise<TTSGenerationResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(QWEN3_LOCAL_TTS_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to download Qwen3 Local TTS audio: ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  return {
    audio: new Uint8Array(await response.arrayBuffer()),
    format: inferAudioFormat(url, contentType),
  };
}

function decodeBase64Audio(base64: string, format: string): TTSGenerationResult {
  return {
    audio: new Uint8Array(Buffer.from(base64.replace(/\s/g, ''), 'base64')),
    format: normalizeFormat(format),
  };
}

function encodeWavFromSamples(samples: unknown, sampleRate: number): Uint8Array {
  const flattened = flattenAudioSamples(samples).map((sample) =>
    Math.max(-1, Math.min(1, Number(sample) || 0)),
  );
  const dataSize = flattened.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < flattened.length; i++) {
    buffer.writeInt16LE(Math.round(flattened[i] * 32767), 44 + i * 2);
  }

  return new Uint8Array(buffer);
}

function flattenAudioSamples(samples: unknown): number[] {
  if (!Array.isArray(samples)) return [];
  if (samples.length > 0 && Array.isArray(samples[0])) {
    return (samples as unknown[][]).map((frame) => {
      const channels = frame.map((sample) => Number(sample) || 0);
      return channels.reduce((sum, sample) => sum + sample, 0) / Math.max(1, channels.length);
    });
  }
  return samples.map((sample) => Number(sample) || 0);
}

function resolveGradioFileUrl(baseUrl: string, filePath: string): string {
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  return `${baseUrl}/file=${filePath.replace(/\\/g, '/')}`;
}

function resolvePossiblyRelativeUrl(baseUrl: string, url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return new URL(url, `${baseUrl}/`).toString();
}

function inferAudioFormat(source: string, contentType: string): string {
  if (contentType.includes('wav') || contentType.includes('wave')) return 'wav';
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('opus')) return 'opus';
  if (contentType.includes('flac')) return 'flac';

  const ext = source.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1];
  return ext ? normalizeFormat(ext) : 'wav';
}

function normalizeFormat(format: string): string {
  const normalized = format.toLowerCase();
  if (normalized === 'x-wav') return 'wav';
  if (normalized === 'mpeg') return 'mp3';
  return normalized;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeApiName(apiName: string | null | undefined | false): string {
  if (!apiName) throw new Error('Qwen3 Local TTS Gradio endpoint is missing api_name');
  return apiName.replace(/^\/+/, '');
}

function getProviderStringOption(config: TTSModelConfig, key: string): string | undefined {
  const value = config.providerOptions?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * MiniMax TTS implementation (synchronous HTTP API)
 */
async function generateMiniMaxTTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['minimax-tts'].defaultBaseUrl || '').replace(
    /\/$/,
    '',
  );
  const response = await fetch(`${baseUrl}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: config.modelId || 'speech-2.8-hd',
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: config.voice,
        speed: config.speed || 1.0,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: config.format || 'mp3',
        channel: 1,
      },
      language_boost: 'auto',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`MiniMax TTS API error: ${errorText}`);
  }

  const data = await response.json();
  const hexAudio = data?.data?.audio;
  if (!hexAudio || typeof hexAudio !== 'string') {
    throw new Error(`MiniMax TTS error: No audio returned. Response: ${JSON.stringify(data)}`);
  }

  const cleanedHex = hexAudio.trim();
  if (cleanedHex.length % 2 !== 0) {
    throw new Error('MiniMax TTS error: invalid hex audio payload length');
  }

  const audio = new Uint8Array(
    cleanedHex.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || [],
  );
  return {
    audio,
    format: data?.extra_info?.audio_format || config.format || 'mp3',
  };
}

/**
 * ElevenLabs TTS implementation (direct API call with voice-specific endpoint)
 */
async function generateElevenLabsTTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const baseUrl = config.baseUrl || TTS_PROVIDERS['elevenlabs-tts'].defaultBaseUrl;
  const requestedFormat = config.format || 'mp3';
  const clampedSpeed = Math.min(1.2, Math.max(0.7, config.speed || 1.0));
  const outputFormatMap: Record<string, string> = {
    mp3: 'mp3_44100_128',
    opus: 'opus_48000_96',
    pcm: 'pcm_44100',
    wav: 'wav_44100',
    ulaw: 'ulaw_8000',
    alaw: 'alaw_8000',
  };
  const outputFormat = outputFormatMap[requestedFormat] || outputFormatMap.mp3;

  const response = await fetch(
    `${baseUrl}/text-to-speech/${encodeURIComponent(config.voice)}?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.apiKey!,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        text,
        model_id: config.modelId || 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: clampedSpeed,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`ElevenLabs TTS API error: ${errorText || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audio: new Uint8Array(arrayBuffer),
    format: requestedFormat,
  };
}

/**
 * Get current TTS configuration from settings store
 * Note: This function should only be called in browser context
 */
export async function getCurrentTTSConfig(): Promise<TTSModelConfig> {
  if (typeof window === 'undefined') {
    throw new Error('getCurrentTTSConfig() can only be called in browser context');
  }

  // Lazy import to avoid circular dependency
  const { useSettingsStore } = await import('@/lib/store/settings');
  const { ttsProviderId, ttsVoice, ttsSpeed, ttsProvidersConfig } = useSettingsStore.getState();

  const providerConfig = ttsProvidersConfig?.[ttsProviderId];

  return {
    providerId: ttsProviderId,
    modelId: providerConfig?.modelId || TTS_PROVIDERS[ttsProviderId]?.defaultModelId || '',
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl,
    voice: ttsVoice,
    speed: ttsSpeed,
  };
}

// Re-export from constants for convenience
export { getAllTTSProviders, getTTSProvider, getTTSVoices } from './constants';

/**
 * Doubao TTS 2.0 implementation (Volcengine Seed-TTS 2.0)
 */
async function generateDoubaoTTS(
  config: TTSModelConfig,
  text: string,
): Promise<TTSGenerationResult> {
  const colonIdx = (config.apiKey || '').indexOf(':');
  if (colonIdx <= 0) {
    throw new Error(
      'Doubao TTS requires API key in format "appId:accessKey". Get both from the Volcengine console.',
    );
  }
  const appId = config.apiKey!.slice(0, colonIdx);
  const accessKey = config.apiKey!.slice(colonIdx + 1);

  const baseUrl = config.baseUrl || TTS_PROVIDERS['doubao-tts'].defaultBaseUrl;
  const speechRate = Math.round(((config.speed || 1.0) - 1.0) * 100);

  const response = await fetch(`${baseUrl}/unidirectional`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Id': appId,
      'X-Api-Access-Key': accessKey,
      'X-Api-Resource-Id': 'seed-tts-2.0',
    },
    body: JSON.stringify({
      user: { uid: 'openmaic' },
      req_params: {
        text,
        speaker: config.voice,
        audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: speechRate },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Doubao TTS API error (${response.status}): ${errorText}`);
  }

  const responseText = await response.text();
  const audioChunks: Uint8Array[] = [];

  let depth = 0;
  let start = -1;
  for (let i = 0; i < responseText.length; i++) {
    if (responseText[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (responseText[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        let chunk: { code: number; message?: string; data?: string };
        try {
          chunk = JSON.parse(responseText.slice(start, i + 1));
        } catch {
          start = -1;
          continue;
        }
        start = -1;

        if (chunk.code === 0 && chunk.data) {
          audioChunks.push(new Uint8Array(Buffer.from(chunk.data, 'base64')));
        } else if (chunk.code === 20000000) {
          break;
        } else if (chunk.code && chunk.code !== 0) {
          if (chunk.code === 45000000 || chunk.code === 45000292) {
            throw new TTSRateLimitError(
              'doubao-tts',
              chunk.message || 'concurrency quota exceeded',
            );
          }
          throw new Error(`Doubao TTS error: ${chunk.message || 'unknown'} (code: ${chunk.code})`);
        }
      }
    }
  }

  if (audioChunks.length === 0) {
    throw new Error('Doubao TTS: no audio data received');
  }

  const totalLength = audioChunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return { audio: combined, format: 'mp3' };
}

/**
 * Escape XML special characters for SSML
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
