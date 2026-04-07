import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TTS_VOICES, getTTSVoices } from '@/lib/audio/constants';
import { generateTTS } from '@/lib/audio/tts-providers';
import { getAvailableProvidersWithVoices } from '@/lib/audio/voice-resolver';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(data: string, status = 200) {
  return new Response(data, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

function audioResponse(bytes: number[]) {
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': 'audio/wav' },
  });
}

const customVoiceConfig = {
  components: [
    { id: 1, props: { label: 'Text' } },
    { id: 2, props: { label: 'Language', choices: ['Auto'], value: 'Auto' } },
    { id: 3, props: { label: 'Speaker', choices: ['Vivian'], value: 'Vivian' } },
    { id: 4, props: { label: 'Instruction' } },
    { id: 5, props: { label: 'Output Audio' } },
    { id: 6, props: { label: 'Status' } },
  ],
  dependencies: [{ id: 0, api_name: 'run_instruct', inputs: [1, 2, 3, 4], outputs: [5, 6] }],
};

describe('qwen3-local-tts provider', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('calls the qwen-tts Gradio CustomVoice endpoint and downloads audio', async () => {
    fetchMock.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = String(url);

      if (urlString === 'http://127.0.0.1:8000/health') {
        return jsonResponse({ error: 'not lightweight service' }, 404);
      }

      if (urlString === 'http://127.0.0.1:8000/config') {
        return jsonResponse(customVoiceConfig);
      }

      if (urlString === 'http://127.0.0.1:8000/run/run_instruct') {
        const body = JSON.parse(String(init?.body));
        expect(body.data).toEqual(['你好', 'Auto', 'Vivian', '']);
        return jsonResponse({
          data: [{ url: '/file=tmp/qwen3-local.wav' }, 'Finished.'],
        });
      }

      if (urlString === 'http://127.0.0.1:8000/file=tmp/qwen3-local.wav') {
        return audioResponse([1, 2, 3]);
      }

      throw new Error(`Unexpected URL: ${urlString}`);
    });

    const result = await generateTTS(
      {
        providerId: 'qwen3-local-tts',
        baseUrl: 'http://127.0.0.1:8000/',
        voice: 'vivian',
        speed: 1,
      },
      '你好',
    );

    expect(result.format).toBe('wav');
    expect(Array.from(result.audio)).toEqual([1, 2, 3]);
  });

  it('falls back to the Gradio queue endpoint when direct run is unavailable', async () => {
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const urlString = String(url);

      if (urlString === 'http://127.0.0.1:8000/health') {
        return jsonResponse({ error: 'not lightweight service' }, 404);
      }

      if (urlString === 'http://127.0.0.1:8000/config') {
        return jsonResponse(customVoiceConfig);
      }

      if (urlString === 'http://127.0.0.1:8000/run/run_instruct') {
        return textResponse('Please join the queue to use this API.', 404);
      }

      if (urlString === 'http://127.0.0.1:8000/call/run_instruct') {
        return jsonResponse({ event_id: 'event-1' });
      }

      if (urlString === 'http://127.0.0.1:8000/call/run_instruct/event-1') {
        return textResponse(
          'event: complete\ndata: [{"url":"/file=tmp/queued.wav"},"Finished."]\n\n',
        );
      }

      if (urlString === 'http://127.0.0.1:8000/file=tmp/queued.wav') {
        return audioResponse([4, 5, 6]);
      }

      throw new Error(`Unexpected URL: ${urlString}`);
    });

    const result = await generateTTS(
      {
        providerId: 'qwen3-local-tts',
        baseUrl: 'http://127.0.0.1:8000',
        voice: 'vivian',
      },
      '排队测试',
    );

    expect(result.format).toBe('wav');
    expect(Array.from(result.audio)).toEqual([4, 5, 6]);
  });

  it('supports a custom JSON endpoint returning base64 audio', async () => {
    fetchMock.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = String(url);

      if (urlString === 'http://127.0.0.1:9000/tts/health') {
        return jsonResponse({ error: 'not lightweight service' }, 404);
      }

      if (urlString === 'http://127.0.0.1:9000/tts/config') {
        return jsonResponse({ error: 'not gradio' }, 404);
      }

      if (urlString === 'http://127.0.0.1:9000/tts') {
        const body = JSON.parse(String(init?.body));
        expect(body.text).toBe('JSON fallback');
        return jsonResponse({ base64: Buffer.from([7, 8, 9]).toString('base64') });
      }

      throw new Error(`Unexpected URL: ${urlString}`);
    });

    const result = await generateTTS(
      {
        providerId: 'qwen3-local-tts',
        baseUrl: 'http://127.0.0.1:9000/tts',
        voice: 'vivian',
      },
      'JSON fallback',
    );

    expect(result.format).toBe('wav');
    expect(Array.from(result.audio)).toEqual([7, 8, 9]);
  });

  it('supports the lightweight qwen_tts HTTP service returning wav bytes', async () => {
    fetchMock.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = String(url);

      if (urlString === 'http://127.0.0.1:8000/health') {
        return jsonResponse({
          ok: true,
          model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
          defaultSpeaker: 'vivian',
        });
      }

      if (urlString === 'http://127.0.0.1:8000') {
        const body = JSON.parse(String(init?.body));
        expect(body.text).toBe('HTTP service fallback');
        expect(body.voice).toBe('vivian');
        expect(body.speaker).toBe('vivian');
        return audioResponse([10, 11, 12]);
      }

      throw new Error(`Unexpected URL: ${urlString}`);
    });

    const result = await generateTTS(
      {
        providerId: 'qwen3-local-tts',
        baseUrl: 'http://127.0.0.1:8000',
        voice: 'vivian',
      },
      'HTTP service fallback',
    );

    expect(result.format).toBe('wav');
    expect(Array.from(result.audio)).toEqual([10, 11, 12]);
  });

  it('exposes the local CustomVoice speakers in keyless voice pickers', () => {
    expect(DEFAULT_TTS_VOICES['qwen3-local-tts']).toBe('vivian');
    expect(getTTSVoices('qwen3-local-tts').map((voice) => voice.id)).toEqual([
      'vivian',
      'serena',
      'uncle_fu',
      'ryan',
      'aiden',
      'ono_anna',
      'sohee',
      'eric',
      'dylan',
    ]);

    const providers = getAvailableProvidersWithVoices({
      'qwen3-local-tts': { apiKey: '', enabled: true },
    });
    const qwen3Local = providers.find((provider) => provider.providerId === 'qwen3-local-tts');

    expect(qwen3Local).toBeDefined();
    expect(qwen3Local?.modelGroups.map((group) => group.modelId)).toEqual([
      'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    ]);
    expect(qwen3Local?.voices.some((voice) => voice.id === 'vivian')).toBe(true);
  });

  it('hides disabled TTS providers from keyless voice pickers', () => {
    const providers = getAvailableProvidersWithVoices({
      'openai-tts': { apiKey: 'sk-test', enabled: false },
      'qwen3-local-tts': { apiKey: '', enabled: false },
    });

    expect(providers.map((provider) => provider.providerId)).not.toContain('openai-tts');
    expect(providers.map((provider) => provider.providerId)).not.toContain('qwen3-local-tts');
  });
});
