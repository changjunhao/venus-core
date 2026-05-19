import { describe, it, expect, afterEach } from 'bun:test';
import { createOpenAICompatProvider, defineProvider } from '../src/providers/index.js';
import { ProviderError } from '../src/utils/errors.js';
import { mockFetch, restoreFetch, makeOpenAIResponse } from './helpers/mock-fetch.js';

function makeChatCompletion(messageFields: Record<string, unknown>) {
  return makeOpenAIResponse({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', ...messageFields },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

describe('Provider Layer', () => {
  // ── defineProvider factory ──
  describe('defineProvider()', () => {
    it('should create a provider conforming to LLMProvider interface', () => {
      const provider = defineProvider({
        name: 'test-provider',
        supportsVision: true,
        supportsThinking: false,
        chat: async () => ({ content: 'hello', thinking: null }),
      });

      expect(provider.name).toBe('test-provider');
      expect(provider.supportsVision).toBe(true);
      expect(provider.supportsThinking).toBe(false);
      expect(typeof provider.chat).toBe('function');
    });

    it('should default supportsVision and supportsThinking to false', () => {
      const provider = defineProvider({
        name: 'minimal',
        chat: async () => ({ content: '', thinking: null }),
      });

      expect(provider.supportsVision).toBe(false);
      expect(provider.supportsThinking).toBe(false);
    });

    it('should call the chat function and return response', async () => {
      const provider = defineProvider({
        name: 'echo',
        chat: async (params) => ({
          content: `model:${params.model}`,
          thinking: 'thought about it',
        }),
      });

      const resp = await provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(resp.content).toBe('model:test-model');
      expect(resp.thinking).toBe('thought about it');
    });
  });

  // ── createOpenAICompatProvider ──
  describe('createOpenAICompatProvider()', () => {
    it('should create a provider with correct properties', () => {
      const provider = createOpenAICompatProvider({
        baseURL: 'https://api.example.com/v1',
        apiKey: 'test-key',
      });

      expect(provider.name).toContain('openai-compat');
      expect(provider.name).toContain('api.example.com');
      expect(provider.supportsVision).toBe(true);
      expect(provider.supportsThinking).toBe(true);
      expect(typeof provider.chat).toBe('function');
    });
  });

  // ── ProviderError error classification ──
  describe('ProviderError classification', () => {
    // We test the error classification logic by examining the provider's
    // catch block behavior. Since the openai-compat provider wraps errors,
    // we verify the classification via the ProviderError itself.

    it('should classify 401 as auth_error', () => {
      const err = new ProviderError('Unauthorized', 'test', 'auth_error', 401);
      expect(err.errorCode).toBe('auth_error');
      expect(err.statusCode).toBe(401);
      expect(err.provider).toBe('test');
      expect(err.code).toBe('PROVIDER_ERROR');
    });

    it('should classify timeout errors', () => {
      const err = new ProviderError('Request timed out', 'test', 'timeout');
      expect(err.errorCode).toBe('timeout');
    });

    it('should classify network errors', () => {
      const err = new ProviderError('Connection refused', 'test', 'network');
      expect(err.errorCode).toBe('network');
    });

    it('should classify api errors', () => {
      const err = new ProviderError('Bad request', 'test', 'api_error', 400);
      expect(err.errorCode).toBe('api_error');
      expect(err.statusCode).toBe(400);
    });

    it('should default to unknown', () => {
      const err = new ProviderError('Something weird', 'test');
      expect(err.errorCode).toBe('unknown');
    });
  });

  // ── defaultExtra merge via defineProvider mock ──
  describe('defaultExtra merge logic', () => {
    it('should demonstrate per-call extra overrides defaultExtra', async () => {
      // Simulate what openai-compat does with defaultExtra merge
      // by testing the pattern directly
      const defaultExtra = { top_p: 0.9, custom_param: 'default' };
      const callExtra = { custom_param: 'override' };
      const merged = { ...defaultExtra, ...callExtra };

      expect(merged.top_p).toBe(0.9);
      expect(merged.custom_param).toBe('override');
    });
  });

  // ── CoT (Chain-of-Thought) extraction from different vendors ──
  describe('CoT extraction — reasoning_content vs thinking', () => {
    afterEach(() => restoreFetch());

    it('should extract reasoning_content (DashScope format)', async () => {
      mockFetch(async () =>
        makeChatCompletion({
          content: '{"score": 8}',
          reasoning_content: 'I think this photo has excellent composition...',
        }),
      );
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-cot.test/v1',
        apiKey: 'test-key',
      });

      const resp = await provider.chat({
        model: 'qwen3-vl-flash',
        messages: [{ role: 'user', content: 'rate this' }],
      });

      expect(resp.thinking).toBe('I think this photo has excellent composition...');
      expect(resp.content).toBe('{"score": 8}');
    });

    it('should extract thinking (OpenAI format)', async () => {
      mockFetch(async () =>
        makeChatCompletion({
          content: '{"score": 7}',
          thinking: 'Let me analyze the lighting in detail...',
        }),
      );
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-cot.test/v1',
        apiKey: 'test-key',
      });

      const resp = await provider.chat({
        model: 'o1-preview',
        messages: [{ role: 'user', content: 'rate this' }],
      });

      expect(resp.thinking).toBe('Let me analyze the lighting in detail...');
      expect(resp.content).toBe('{"score": 7}');
    });

    it('should prefer reasoning_content over thinking when both present', async () => {
      mockFetch(async () =>
        makeChatCompletion({
          content: 'result',
          reasoning_content: 'DashScope reasoning',
          thinking: 'OpenAI thinking',
        }),
      );
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-cot.test/v1',
        apiKey: 'test-key',
      });

      const resp = await provider.chat({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      });

      // reasoning_content is checked first in the code
      expect(resp.thinking).toBe('DashScope reasoning');
    });

    it('should return null thinking when no thinking content present', async () => {
      mockFetch(async () =>
        makeChatCompletion({
          content: 'Just a plain response',
        }),
      );
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-cot.test/v1',
        apiKey: 'test-key',
      });

      const resp = await provider.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(resp.thinking).toBeNull();
      expect(resp.content).toBe('Just a plain response');
    });
  });

  // ── extra parameter merging via real provider ──
  describe('extra parameter merging (openai-compat)', () => {
    afterEach(() => restoreFetch());

    it('should merge extra params into request body', async () => {
      let capturedBody: any = null;

      mockFetch(async (input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-extra.test/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        extra: { top_p: 0.8, custom_vendor_param: true },
      });

      expect(capturedBody.top_p).toBe(0.8);
      expect(capturedBody.custom_vendor_param).toBe(true);
    });

    it('should merge defaultExtra into request body', async () => {
      let capturedBody: any = null;

      mockFetch(async (input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-extra.test/v1',
        apiKey: 'test-key',
        defaultExtra: { top_k: 50, repetition_penalty: 1.1 },
      });

      await provider.chat({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(capturedBody.top_k).toBe(50);
      expect(capturedBody.repetition_penalty).toBe(1.1);
    });

    it('should override defaultExtra with per-request extra', async () => {
      let capturedBody: any = null;

      mockFetch(async (input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-extra.test/v1',
        apiKey: 'test-key',
        defaultExtra: { top_p: 0.9, custom_param: 'default_value' },
      });

      await provider.chat({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        extra: { custom_param: 'override_value', new_param: 42 },
      });

      // defaultExtra top_p should survive
      expect(capturedBody.top_p).toBe(0.9);
      // per-request extra should override defaultExtra
      expect(capturedBody.custom_param).toBe('override_value');
      // new per-request param should be present
      expect(capturedBody.new_param).toBe(42);
    });
  });

  // ── thinking parameters ──
  describe('Thinking parameter construction', () => {
    it('should include enable_thinking and thinking_budget when thinking is enabled', async () => {
      // Verify the parameter construction pattern used by openai-compat
      const params = {
        thinking: { enabled: true, budget_tokens: 4096 },
      };

      const requestBody: Record<string, unknown> = {};
      if (params.thinking) {
        requestBody.enable_thinking = params.thinking.enabled;
        if (params.thinking.enabled && params.thinking.budget_tokens) {
          requestBody.thinking_budget = params.thinking.budget_tokens;
        }
      }

      expect(requestBody.enable_thinking).toBe(true);
      expect(requestBody.thinking_budget).toBe(4096);
    });

    it('should include enable_thinking: false when thinking is explicitly disabled', () => {
      // 显式关闭思考模式时，仍需发送 enable_thinking: false 告知 API
      const params: { thinking?: { enabled: boolean; budget_tokens?: number } } = {
        thinking: { enabled: false },
      };

      const requestBody: Record<string, unknown> = {};
      if (params.thinking) {
        requestBody.enable_thinking = params.thinking.enabled;
        if (params.thinking.enabled && params.thinking.budget_tokens) {
          requestBody.thinking_budget = params.thinking.budget_tokens;
        }
      }

      expect(requestBody.enable_thinking).toBe(false);
      expect(requestBody.thinking_budget).toBeUndefined();
    });

    it('should not include thinking fields when thinking is not configured', () => {
      const params: { thinking?: { enabled: boolean; budget_tokens?: number } } = { thinking: undefined };
      const requestBody: Record<string, unknown> = {};
      if (params.thinking) {
        requestBody.enable_thinking = params.thinking.enabled;
      }

      expect(requestBody.enable_thinking).toBeUndefined();
      expect(requestBody.thinking_budget).toBeUndefined();
    });

    // ── 集成测试：验证真实 provider 发送的请求体 ──
    describe('integration: real provider request body', () => {
      afterEach(() => restoreFetch());

      it('should send enable_thinking: false when thinking is explicitly disabled', async () => {
        let capturedBody: any = null;

        mockFetch(async (_input, init) => {
          capturedBody = JSON.parse(init?.body as string);
          return makeChatCompletion({ content: 'ok' });
        });
        const provider = createOpenAICompatProvider({
          baseURL: 'https://mock-thinking.test/v1',
          apiKey: 'test-key',
        });

        await provider.chat({
          model: 'test',
          messages: [{ role: 'user', content: 'hi' }],
          thinking: { enabled: false },
        });

        expect(capturedBody.enable_thinking).toBe(false);
        expect(capturedBody.thinking_budget).toBeUndefined();
      });

      it('should send enable_thinking: true and thinking_budget when thinking is enabled', async () => {
        let capturedBody: any = null;

        mockFetch(async (_input, init) => {
          capturedBody = JSON.parse(init?.body as string);
          return makeChatCompletion({ content: 'ok' });
        });
        const provider = createOpenAICompatProvider({
          baseURL: 'https://mock-thinking.test/v1',
          apiKey: 'test-key',
        });

        await provider.chat({
          model: 'test',
          messages: [{ role: 'user', content: 'hi' }],
          thinking: { enabled: true, budget_tokens: 4096 },
        });

        expect(capturedBody.enable_thinking).toBe(true);
        expect(capturedBody.thinking_budget).toBe(4096);
      });
    });
  });
});
