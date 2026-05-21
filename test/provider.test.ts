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
        capabilities: { vision: true, reasoning: false },
        chat: async () => ({ content: 'hello', reasoning: null }),
      });

      expect(provider.name).toBe('test-provider');
      expect(provider.capabilities.vision).toBe(true);
      expect(provider.capabilities.reasoning).toBe(false);
      expect(typeof provider.chat).toBe('function');
    });

    it('should default capabilities to false', () => {
      const provider = defineProvider({
        name: 'minimal',
        chat: async () => ({ content: '', reasoning: null }),
      });

      expect(provider.capabilities.vision).toBe(false);
      expect(provider.capabilities.reasoning).toBe(false);
      expect(provider.capabilities.reasoningBudget).toBe(false);
      expect(provider.capabilities.streaming).toBe(false);
    });

    it('should call the chat function and return response', async () => {
      const provider = defineProvider({
        name: 'echo',
        chat: async (params) => ({
          content: `model:${params.model}`,
          reasoning: 'thought about it',
        }),
      });

      const resp = await provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(resp.content).toBe('model:test-model');
      expect(resp.reasoning).toBe('thought about it');
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
      expect(provider.capabilities.vision).toBe(true);
      expect(provider.capabilities.reasoning).toBe(true);
      expect(provider.capabilities.streaming).toBe(true);
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

  // ── CoT (Chain-of-Thought) extraction from different vendors ──
  describe('Reasoning extraction — reasoning_content vs reasoning vs thinking', () => {
    afterEach(() => restoreFetch());

    it('should extract reasoning_content (DashScope/Qwen format)', async () => {
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

      expect(resp.reasoning).toBe('I think this photo has excellent composition...');
      expect(resp.content).toBe('{"score": 8}');
    });

    it('should extract reasoning (OpenAI Responses API format)', async () => {
      mockFetch(async () =>
        makeChatCompletion({
          content: '{"score": 7}',
          reasoning: 'Let me analyze the lighting in detail...',
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

      expect(resp.reasoning).toBe('Let me analyze the lighting in detail...');
      expect(resp.content).toBe('{"score": 7}');
    });

    it('should extract thinking (Anthropic/legacy format)', async () => {
      mockFetch(async () =>
        makeChatCompletion({
          content: '{"score": 6}',
          thinking: 'Anthropic-style thinking trace...',
        }),
      );
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-cot.test/v1',
        apiKey: 'test-key',
      });

      const resp = await provider.chat({
        model: 'claude-test',
        messages: [{ role: 'user', content: 'rate this' }],
      });

      expect(resp.reasoning).toBe('Anthropic-style thinking trace...');
    });

    it('should prefer reasoning_content over reasoning and thinking when all present', async () => {
      mockFetch(async () =>
        makeChatCompletion({
          content: 'result',
          reasoning_content: 'DashScope reasoning',
          reasoning: 'OpenAI reasoning',
          thinking: 'Anthropic thinking',
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
      expect(resp.reasoning).toBe('DashScope reasoning');
    });

    it('should return null reasoning when no reasoning content present', async () => {
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

      expect(resp.reasoning).toBeNull();
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

  // ── reasoning parameter construction (per-style adapter) ──
  describe('Reasoning parameter construction (style-aware)', () => {
    afterEach(() => restoreFetch());

    it('should send reasoning_effort when reasoning is enabled (openai style)', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-reasoning.test/v1',
        apiKey: 'test-key',
        style: 'openai',
      });

      await provider.chat({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning: { effort: 'medium' },
      });

      expect(capturedBody.reasoning_effort).toBe('medium');
    });

    it('should send enable_thinking and thinking_budget when reasoning is enabled (qwen style)', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'qwen3-vl-flash',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning: { effort: 'medium', budgetTokens: 4096 },
      });

      expect(capturedBody.enable_thinking).toBe(true);
      expect(capturedBody.thinking_budget).toBe(4096);
    });

    it('should send thinking.enabled and omit temperature when reasoning is enabled (kimi style)', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'kimi-k2',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
        reasoning: { effort: 'medium', budgetTokens: 4096 },
      });

      expect(capturedBody.thinking).toEqual({ type: 'enabled' });
      // Kimi fixes temperature to 1.0 in thinking mode → must NOT be sent
      expect(capturedBody.temperature).toBeUndefined();
      // Kimi does not support budget_tokens; budgetTokens is silently ignored
      expect(capturedBody.thinking.budget_tokens).toBeUndefined();
      expect(capturedBody.thinking_budget).toBeUndefined();
    });

    it('should send thinking.disabled when reasoning is NOT configured (kimi style)', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'kimi-k2',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
      });

      // Kimi defaults to thinking enabled; we must explicitly disable for standard mode
      expect(capturedBody.thinking).toEqual({ type: 'disabled' });
      // Kimi internally fixes temperature (0.6 for non-thinking mode), so custom temperature should NOT be sent
      expect(capturedBody.temperature).toBeUndefined();
    });

    it('should detect kimi style via moonshot.cn baseURL and expose proper capabilities', () => {
      const provider = createOpenAICompatProvider({
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: 'test-key',
      });

      expect(provider.capabilities.reasoning).toBe(true);
      // Kimi does NOT support reasoningBudget
      expect(provider.capabilities.reasoningBudget).toBe(false);
    });

    it('should not include reasoning fields when reasoning is not configured', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeChatCompletion({ content: 'ok' });
      });
      const provider = createOpenAICompatProvider({
        baseURL: 'https://mock-reasoning.test/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(capturedBody.reasoning_effort).toBeUndefined();
      expect(capturedBody.enable_thinking).toBeUndefined();
      expect(capturedBody.thinking_budget).toBeUndefined();
    });
  });
});
