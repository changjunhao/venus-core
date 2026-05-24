import { describe, it, expect, afterEach } from 'bun:test';
import { createOpenAIChatProvider } from '../src/providers/index.js';
import { createVenusEngine } from '../src/engine.js';
import { defineProvider } from '../src/providers/index.js';
import { ProviderError, VenusError } from '../src/utils/errors.js';
import type { EvaluationEvent } from '../src/types.js';
import { restoreFetch, makeOpenAIResponse } from './helpers/mock-fetch.js';

/**
 * Create provider AFTER mocking fetch so the OpenAI SDK picks up the mock.
 */
function createProviderWithMockedFetch(fetchImpl: (...args: any[]) => any) {
  globalThis.fetch = fetchImpl as typeof globalThis.fetch;
  return createOpenAIChatProvider({
    baseURL: 'https://mock-api.test/v1',
    apiKey: 'test-key',
    timeout: 5000,
  });
}

describe('Error Handling — Provider Error Classification', () => {
  afterEach(() => restoreFetch());

  // ── Network errors ──
  describe('Network errors (ECONNREFUSED)', () => {
    it('should classify ECONNREFUSED as network error', async () => {
      const provider = createProviderWithMockedFetch(async () => {
        const err = new TypeError('fetch failed');
        (err as any).code = 'ECONNREFUSED';
        throw err;
      });

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('network');
      }
    });

    it('should classify ENOTFOUND as network error', async () => {
      const provider = createProviderWithMockedFetch(async () => {
        const err = new TypeError('fetch failed');
        (err as any).code = 'ENOTFOUND';
        throw err;
      });

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).errorCode).toBe('network');
      }
    });

    it('should classify "fetch failed" message as network error', async () => {
      const provider = createProviderWithMockedFetch(async () => {
        throw new Error('fetch failed');
      });

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).errorCode).toBe('network');
      }
    });
  });

  // ── Auth errors ──
  describe('Authentication errors (401/403)', () => {
    it('should classify 401 as auth_error', async () => {
      const provider = createProviderWithMockedFetch(async () =>
        makeOpenAIResponse({ error: { message: 'Unauthorized', type: 'auth_error' } }, 401),
      );

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('auth_error');
        expect(pe.statusCode).toBe(401);
      }
    });

    it('should classify 403 as auth_error', async () => {
      const provider = createProviderWithMockedFetch(async () =>
        makeOpenAIResponse({ error: { message: 'Forbidden', type: 'auth_error' } }, 403),
      );

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('auth_error');
        expect(pe.statusCode).toBe(403);
      }
    });
  });

  // ── Timeout errors ──
  describe('Timeout errors', () => {
    it('should classify ETIMEDOUT as timeout', async () => {
      const provider = createProviderWithMockedFetch(async () => {
        const err = new Error('Connection timed out');
        (err as any).code = 'ETIMEDOUT';
        throw err;
      });

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).errorCode).toBe('timeout');
      }
    });

    it('should classify ESOCKETTIMEDOUT as timeout', async () => {
      const provider = createProviderWithMockedFetch(async () => {
        const err = new Error('Socket timed out');
        (err as any).code = 'ESOCKETTIMEDOUT';
        throw err;
      });

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).errorCode).toBe('timeout');
      }
    });

    it('should classify error message containing "timeout" as timeout', async () => {
      const provider = createProviderWithMockedFetch(async () => {
        throw new Error('Request timeout after 5000ms');
      });

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).errorCode).toBe('timeout');
      }
    });
  });

  // ── API errors (500 etc) ──
  describe('API errors (5xx)', () => {
    it('should classify 500 as api_error', async () => {
      const provider = createProviderWithMockedFetch(async () =>
        makeOpenAIResponse({ error: { message: 'Internal Server Error' } }, 500),
      );

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.statusCode).toBe(500);
      }
    });

    it('should classify 502 as api_error', async () => {
      const provider = createProviderWithMockedFetch(async () =>
        makeOpenAIResponse({ error: { message: 'Bad Gateway' } }, 502),
      );

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.statusCode).toBe(502);
      }
    });
  });

  // ── Parse errors (empty response) ──
  describe('Parse / empty response errors', () => {
    it('should throw api_error when response has no choices', async () => {
      const provider = createProviderWithMockedFetch(async () =>
        makeOpenAIResponse({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      );

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.message).toContain('Empty response');
      }
    });

    it('should throw api_error when choice has no message', async () => {
      const provider = createProviderWithMockedFetch(async () =>
        makeOpenAIResponse({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [{ index: 0, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      );

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).errorCode).toBe('api_error');
      }
    });
  });

  // ── Rate limiting (429) ──
  describe('Rate limiting (429)', () => {
    it('should classify 429 as api_error', async () => {
      const provider = createProviderWithMockedFetch(async () =>
        makeOpenAIResponse({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }, 429),
      );

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.statusCode).toBe(429);
      }
    });
  });

  // ── Already-wrapped ProviderError passthrough ──
  describe('ProviderError passthrough', () => {
    it('should rethrow ProviderError without re-wrapping', async () => {
      const provider = defineProvider({
        name: 'error-passthrough',
        chat: async () => {
          throw new ProviderError('Custom provider error', 'custom', 'parse_error', 422);
        },
      });

      try {
        await provider.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.errorCode).toBe('parse_error');
        expect(pe.provider).toBe('custom');
        expect(pe.statusCode).toBe(422);
      }
    });
  });
});

describe('Error Handling — Engine Error Event Propagation', () => {
  it('should emit error event when provider throws during evaluate()', async () => {
    const events: EvaluationEvent[] = [];

    const errorProvider = defineProvider({
      name: 'failing-provider',
      capabilities: { vision: true },
      chat: async () => {
        throw new ProviderError('Provider network failure', 'failing-provider', 'network');
      },
    });

    const engine = createVenusEngine({
      provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
      defaultModel: 'test-model',
      providers: {
        proposer: errorProvider,
        critic: errorProvider,
        arbiter: errorProvider,
      },
      onEvent: (event) => events.push(event),
    });

    try {
      await engine.evaluate('https://example.com/img.jpg', 'portrait');
    } catch {
      // expected — BaseAgent wraps as SchemaError after retries
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.agent).toBe('engine');
    expect(errorEvent!.data).toBeDefined();
  });

  it('should propagate error (wrapped as SchemaError by BaseAgent) through evaluate()', async () => {
    const errorProvider = defineProvider({
      name: 'auth-fail-provider',
      capabilities: { vision: true },
      chat: async () => {
        throw new ProviderError('Auth failed', 'auth-fail-provider', 'auth_error', 401);
      },
    });

    const engine = createVenusEngine({
      provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
      defaultModel: 'test-model',
      providers: {
        proposer: errorProvider,
        critic: errorProvider,
        arbiter: errorProvider,
      },
    });

    try {
      await engine.evaluate('https://example.com/img.jpg', 'portrait');
      expect(true).toBe(false);
    } catch (e) {
      // BaseAgent retries 3 times, then wraps as SchemaError
      expect(e).toBeInstanceOf(VenusError);
      expect((e as VenusError).message).toContain('Auth failed');
    }
  });

  it('should yield error event in evaluateStream() with correct error info', async () => {
    const errorProvider = defineProvider({
      name: 'stream-fail-provider',
      capabilities: { vision: true },
      chat: async () => {
        throw new ProviderError('Timeout!', 'stream-fail-provider', 'timeout');
      },
    });

    const engine = createVenusEngine({
      provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
      defaultModel: 'test-model',
      providers: {
        proposer: errorProvider,
        critic: errorProvider,
        arbiter: errorProvider,
      },
    });

    const events: Array<{ type: string; error?: { message: string; code?: string } }> = [];
    for await (const event of engine.evaluateStream('https://example.com/img.jpg', { genre: 'portrait' })) {
      events.push(event as any);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.error!.message).toContain('Timeout');
    // BaseAgent wraps to SchemaError after retries
    expect(errorEvent!.error!.code).toBe('SCHEMA_ERROR');
  });

  it('should throw when mock provider is exhausted (all responses consumed)', async () => {
    const { createMockProvider } = await import('./helpers/mock-provider.js');
    // Create a provider with only 1 response
    const exhaustedProvider = createMockProvider([{ content: '{}' }]);

    // First call consumes the only response
    await exhaustedProvider.chat({ model: 'test', messages: [{ role: 'user' as const, content: 'hi' }] });

    // Second call should throw (exhausted)
    try {
      await exhaustedProvider.chat({ model: 'test', messages: [{ role: 'user' as const, content: 'hi' }] });
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain('Mock provider exhausted');
    }
  });
});
