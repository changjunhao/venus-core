import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';
import { createAnthropicProvider, mapThinking } from '../../src/providers/anthropic.js';
import { createGeminiProvider } from '../../src/providers/gemini.js';
import { createOpenAIResponsesProvider } from '../../src/providers/openai-responses.js';
import { ProviderError } from '../../src/utils/errors.js';
import { mockFetch, restoreFetch } from '../helpers/mock-fetch.js';

describe('Skeleton Providers', () => {
  describe('createAnthropicProvider()', () => {
    beforeEach(() => {
      // Deterministic vectorjson stub (other stream test files mock this globally).
      mock.module('vectorjson', () => ({
        createParser: () => {
          let buffer = '';
          return {
            feed(text: string) {
              buffer += text;
            },
            getValue() {
              try {
                return JSON.parse(buffer);
              } catch {
                return undefined;
              }
            },
            destroy() {},
          };
        },
      }));
    });

    afterEach(() => restoreFetch());

    function makeAnthropicProvider(overrides: Record<string, unknown> = {}) {
      return createAnthropicProvider({ apiKey: 'test-key', defaultModel: 'claude-sonnet-4-5', ...overrides });
    }

    /** Extract the JSON request body regardless of how the SDK invokes fetch */
    async function readRequestBody(input: any, init: any): Promise<any> {
      if (init?.body) return JSON.parse(init.body as string);
      if (input instanceof Request) return JSON.parse(await input.clone().text());
      return null;
    }

    /** Build a mock Messages API non-streaming response */
    function makeMessageResponse(overrides: Record<string, unknown> = {}) {
      return new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [
            { type: 'thinking', thinking: 'Analyzing the image...' },
            { type: 'text', text: '{"score": 8}' },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } },
          ...overrides,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    /** Build a mock Messages API SSE streaming response */
    function makeMessageSSEResponse(events: Array<Record<string, unknown>>) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    it('should create a provider with correct name and capabilities', () => {
      const provider = makeAnthropicProvider();
      expect(provider.name).toBe('anthropic(https://api.anthropic.com)');
      expect(provider.capabilities.reasoning).toBe(true);
      expect(provider.capabilities.reasoningBudget).toBe(true);
      expect(provider.capabilities.vision).toBe(true);
      expect(provider.capabilities.streaming).toBe(true);
      expect(provider.capabilities.structuredOutput).toBe('json_schema');
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.chatStream).toBe('function');
    });

    it('should include custom baseURL in provider name', () => {
      const provider = makeAnthropicProvider({ baseURL: 'https://proxy.example.com' });
      expect(provider.name).toBe('anthropic(https://proxy.example.com)');
    });

    it('should lift system prompt, map turns and pass image URLs directly', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider();
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [
          { role: 'system', content: 'You are a photography judge.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Rate this photo.' },
              { type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } },
            ],
          },
        ],
      });

      expect(capturedBody.model).toBe('claude-sonnet-4-5');
      expect(capturedBody.max_tokens).toBe(4096);
      expect(capturedBody.system).toBe('You are a photography judge.');
      expect(capturedBody.messages).toHaveLength(1);
      expect(capturedBody.messages[0].role).toBe('user');
      expect(capturedBody.messages[0].content).toEqual([
        { type: 'text', text: 'Rate this photo.' },
        // Public URL passed through directly as a url image source
        { type: 'image', source: { type: 'url', url: 'https://example.com/photo.jpg' } },
      ]);
    });

    it('should convert data: URLs to base64 image sources and keep string content', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider();
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
          },
          { role: 'assistant', content: '{"score": 5}' },
          { role: 'user', content: 'Try again.' },
        ],
      });

      expect(capturedBody.messages[0].content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      ]);
      expect(capturedBody.messages[1]).toEqual({ role: 'assistant', content: '{"score": 5}' });
      expect(capturedBody.messages[2].role).toBe('user');
    });

    it('should map reasoning effort to thinking budget and omit temperature', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider();
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
        reasoning: { effort: 'medium' },
      });

      // getDefaultBudget('medium') === 8192
      expect(capturedBody.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
      // max_tokens grows to exceed the thinking budget (8192 + 4096 reserve)
      expect(capturedBody.max_tokens).toBe(12288);
      // temperature is omitted when thinking is enabled
      expect(capturedBody.temperature).toBeUndefined();
    });

    it('should clamp thinking budget to the 1024 minimum', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider();
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        // getDefaultBudget('minimal') === 512, below the 1024 minimum
        reasoning: { effort: 'minimal' },
      });

      expect(capturedBody.thinking.budget_tokens).toBe(1024);
    });

    it('should omit thinking and forward temperature when reasoning is not configured', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider();
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
      });

      expect(capturedBody.thinking).toBeUndefined();
      expect(capturedBody.temperature).toBe(0.5);
    });

    it('should resolve max_tokens from extra.max_tokens / defaultMaxTokens', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider({ defaultMaxTokens: 2048 });
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(capturedBody.max_tokens).toBe(2048);

      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        extra: { max_tokens: 1000 },
      });
      // per-call extra.max_tokens wins and is not duplicated as a body field
      expect(capturedBody.max_tokens).toBe(1000);
    });

    it('should send output_config.format for json_schema and nothing for json_object', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider();
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          name: 'test_schema',
          schema: { type: 'object', properties: { score: { type: 'number' } } },
          strict: true,
        },
      });
      expect(capturedBody.output_config).toEqual({
        format: { type: 'json_schema', schema: { type: 'object', properties: { score: { type: 'number' } } } },
      });

      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: { type: 'json_object' },
      });
      expect(capturedBody.output_config).toBeUndefined();
    });

    it('should merge defaultExtra and per-call extra into the request body', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeMessageResponse();
      });

      const provider = makeAnthropicProvider({ defaultExtra: { metadata: { user_id: 'u1' } } });
      await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        extra: { top_p: 0.9 },
      });

      expect(capturedBody.metadata).toEqual({ user_id: 'u1' });
      expect(capturedBody.top_p).toBe(0.9);
    });

    it('should parse text, thinking and usage from the response', async () => {
      mockFetch(async () => makeMessageResponse());

      const provider = makeAnthropicProvider();
      const resp = await provider.chat({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'rate this' }],
      });

      expect(resp.content).toBe('{"score": 8}');
      expect(resp.reasoning).toBe('Analyzing the image...');
      expect(resp.usage).toEqual({ inputTokens: 10, outputTokens: 20, reasoningTokens: 5 });
    });

    it('should throw api_error when the response carries no text block', async () => {
      mockFetch(async () => makeMessageResponse({ content: [{ type: 'thinking', thinking: 'only thinking' }] }));

      const provider = makeAnthropicProvider();
      try {
        await provider.chat({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('api_error');
        expect((error as ProviderError).message).toContain('Empty response');
      }
    });

    it('should classify 401 as auth_error', async () => {
      mockFetch(
        async () =>
          new Response(
            JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
            {
              status: 401,
              headers: { 'content-type': 'application/json' },
            },
          ),
      );

      const provider = makeAnthropicProvider();
      try {
        await provider.chat({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('auth_error');
        expect((error as ProviderError).statusCode).toBe(401);
      }
    });

    it('should classify 400 as api_error', async () => {
      mockFetch(
        async () =>
          new Response(
            JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' },
            },
          ),
      );

      const provider = makeAnthropicProvider();
      try {
        await provider.chat({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('api_error');
      }
    });

    it('should classify fetch failures as network errors', async () => {
      mockFetch(async () => {
        throw new Error('fetch failed');
      });

      const provider = makeAnthropicProvider();
      try {
        await provider.chat({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('network');
      }
    });

    it('should stream reasoning, content, partial and usage chunks', async () => {
      mockFetch(async () =>
        makeMessageSSEResponse([
          {
            type: 'message_start',
            message: {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-sonnet-4-5',
              stop_reason: null,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'Evaluating composition' },
          },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' and lighting' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"sco' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 're": 8}' } },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } },
          },
          { type: 'message_stop' },
        ]),
      );

      const provider = makeAnthropicProvider();
      const chunks: Array<Record<string, unknown>> = [];
      for await (const chunk of provider.chatStream!({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'rate this' }],
      })) {
        chunks.push(chunk as Record<string, unknown>);
      }

      const reasoning = chunks
        .filter((c) => typeof c.reasoning === 'string')
        .map((c) => c.reasoning)
        .join('');
      expect(reasoning).toBe('Evaluating composition and lighting');

      const content = chunks
        .filter((c) => typeof c.content === 'string')
        .map((c) => c.content)
        .join('');
      expect(content).toBe('{"score": 8}');

      expect(chunks.some((c) => c.partial && (c.partial as Record<string, unknown>).score === 8)).toBe(true);

      const usageChunks = chunks.filter((c) => c.usage);
      expect(usageChunks).toHaveLength(1);
      expect(usageChunks[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 20, reasoningTokens: 5 });
    });

    it('should throw ProviderError on stream error events', async () => {
      mockFetch(async () =>
        makeMessageSSEResponse([
          {
            type: 'message_start',
            message: {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-sonnet-4-5',
              stop_reason: null,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          },
          { type: 'error', error: { type: 'overloaded_error', message: 'stream exploded' } },
        ]),
      );

      const provider = makeAnthropicProvider();
      try {
        for await (const _chunk of provider.chatStream!({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          // drain
        }
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).message).toContain('stream exploded');
      }
    });

    describe('DashScope Anthropic-compatible endpoint (behavior=dashscope)', () => {
      const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/apps/anthropic';

      function makeDashScopeProvider(overrides: Record<string, unknown> = {}) {
        return makeAnthropicProvider({ baseURL: DASHSCOPE_BASE_URL, defaultModel: 'qwen3.7-plus', ...overrides });
      }

      it('should keep json_schema structured output capability for DashScope', () => {
        const provider = makeDashScopeProvider();
        expect(provider.name).toBe(`anthropic(${DASHSCOPE_BASE_URL})`);
        expect(provider.capabilities.structuredOutput).toBe('json_schema');
      });

      it('should send thinking disabled explicitly and forward temperature when reasoning is not configured', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeDashScopeProvider();
        await provider.chat({
          model: 'qwen3.7-plus',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.3,
        });

        // DashScope models may default to thinking enabled — disable explicitly
        expect(capturedBody.thinking).toEqual({ type: 'disabled' });
        // temperature is compatible with thinking disabled
        expect(capturedBody.temperature).toBe(0.3);
      });

      it('should send thinking disabled for effort none', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeDashScopeProvider();
        await provider.chat({
          model: 'qwen3.7-plus',
          messages: [{ role: 'user', content: 'hi' }],
          reasoning: { effort: 'none' },
        });

        expect(capturedBody.thinking).toEqual({ type: 'disabled' });
      });

      it('should map reasoning effort to thinking budget and omit temperature (same as official)', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeDashScopeProvider();
        await provider.chat({
          model: 'qwen3.7-plus',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.3,
          reasoning: { effort: 'medium' },
        });

        expect(capturedBody.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
        expect(capturedBody.temperature).toBeUndefined();
      });

      it('should send output_config.format json_schema for DashScope (plain JSON mode)', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeDashScopeProvider();
        await provider.chat({
          model: 'qwen3.7-plus',
          messages: [{ role: 'user', content: 'Output JSON.' }],
          response_format: {
            type: 'json_schema',
            name: 'test_schema',
            schema: { type: 'object', properties: { score: { type: 'number' } } },
            strict: true,
          },
        });

        expect(capturedBody.output_config).toEqual({
          format: { type: 'json_schema', schema: { type: 'object', properties: { score: { type: 'number' } } } },
        });
      });
    });

    describe('Zhipu Anthropic-compatible endpoint (behavior=zhipu)', () => {
      const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';

      function makeZhipuProvider(overrides: Record<string, unknown> = {}) {
        return makeAnthropicProvider({ baseURL: ZHIPU_BASE_URL, defaultModel: 'glm-4.6', ...overrides });
      }

      it('should degrade structured output capability to json_object and drop reasoningBudget', () => {
        const provider = makeZhipuProvider();
        expect(provider.name).toBe(`anthropic(${ZHIPU_BASE_URL})`);
        expect(provider.capabilities.structuredOutput).toBe('json_object');
        expect(provider.capabilities.reasoningBudget).toBe(false);
      });

      it('should send thinking disabled explicitly and forward temperature when reasoning is not configured', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeZhipuProvider();
        await provider.chat({
          model: 'glm-4.6',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.3,
        });

        // GLM models default to thinking enabled — disable explicitly
        expect(capturedBody.thinking).toEqual({ type: 'disabled' });
        // temperature is compatible with thinking disabled
        expect(capturedBody.temperature).toBe(0.3);
      });

      it('should send thinking disabled for effort none', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeZhipuProvider();
        await provider.chat({
          model: 'glm-4.6',
          messages: [{ role: 'user', content: 'hi' }],
          reasoning: { effort: 'none' },
        });

        expect(capturedBody.thinking).toEqual({ type: 'disabled' });
      });

      it('should enable thinking without budget_tokens, grow max_tokens and omit temperature', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeZhipuProvider();
        await provider.chat({
          model: 'glm-4.6',
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 0.3,
          reasoning: { effort: 'medium' },
        });

        // GLM has no tunable thinking budget — only the toggle is sent
        expect(capturedBody.thinking).toEqual({ type: 'enabled' });
        expect(capturedBody.thinking.budget_tokens).toBeUndefined();
        // max_tokens still reserves room for thinking (8192 budget + 4096 reserve)
        expect(capturedBody.max_tokens).toBe(12288);
        expect(capturedBody.temperature).toBeUndefined();
      });

      it('should not send output_config for json_schema (degrades to prompt-driven JSON)', async () => {
        let capturedBody: any = null;
        mockFetch(async (input: any, init: any) => {
          capturedBody = await readRequestBody(input, init);
          return makeMessageResponse();
        });

        const provider = makeZhipuProvider();
        await provider.chat({
          model: 'glm-4.6',
          messages: [{ role: 'user', content: 'Output JSON.' }],
          response_format: {
            type: 'json_schema',
            name: 'test_schema',
            schema: { type: 'object', properties: { score: { type: 'number' } } },
            strict: true,
          },
        });

        expect(capturedBody.output_config).toBeUndefined();
      });
    });

    describe('mapThinking()', () => {
      it('omits thinking for undefined reasoning without behavior (official default)', () => {
        expect(mapThinking(undefined)).toEqual({ budget: 0 });
      });

      it('omits thinking for effort none without behavior (official default)', () => {
        expect(mapThinking({ effort: 'none' })).toEqual({ budget: 0 });
      });

      it('returns thinking disabled for undefined reasoning on dashscope', () => {
        expect(mapThinking(undefined, 'dashscope')).toEqual({ thinking: { type: 'disabled' }, budget: 0 });
      });

      it('returns thinking disabled for effort none on dashscope', () => {
        expect(mapThinking({ effort: 'none' }, 'dashscope')).toEqual({ thinking: { type: 'disabled' }, budget: 0 });
      });

      it('returns identical enabled config with and without behavior', () => {
        const expected = { thinking: { type: 'enabled', budget_tokens: 8192 }, budget: 8192 };
        expect(mapThinking({ effort: 'medium' })).toEqual(expected as never);
        expect(mapThinking({ effort: 'medium' }, 'dashscope')).toEqual(expected as never);
      });

      it('clamps dashscope thinking budget to the 1024 minimum', () => {
        expect(mapThinking({ effort: 'minimal' }, 'dashscope')).toEqual({
          thinking: { type: 'enabled', budget_tokens: 1024 },
          budget: 1024,
        });
      });

      it('returns thinking disabled for undefined reasoning on zhipu', () => {
        expect(mapThinking(undefined, 'zhipu')).toEqual({ thinking: { type: 'disabled' }, budget: 0 });
      });

      it('returns thinking disabled for effort none on zhipu', () => {
        expect(mapThinking({ effort: 'none' }, 'zhipu')).toEqual({ thinking: { type: 'disabled' }, budget: 0 });
      });

      it('returns thinking enabled without budget_tokens on zhipu', () => {
        expect(mapThinking({ effort: 'medium' }, 'zhipu')).toEqual({
          thinking: { type: 'enabled' },
          budget: 8192,
        });
      });

      it('clamps zhipu resolved budget to the 1024 minimum (max_tokens sizing only)', () => {
        expect(mapThinking({ effort: 'minimal' }, 'zhipu')).toEqual({
          thinking: { type: 'enabled' },
          budget: 1024,
        });
      });
    });
  });

  describe('createGeminiProvider()', () => {
    beforeEach(() => {
      // Register a deterministic vectorjson stub — other stream test files mock
      // this module globally (getValue → undefined), which would otherwise leak
      // into this file and break the partial-JSON assertions below.
      mock.module('vectorjson', () => ({
        createParser: () => {
          let buffer = '';
          return {
            feed(text: string) {
              buffer += text;
            },
            getValue() {
              try {
                return JSON.parse(buffer);
              } catch {
                return undefined;
              }
            },
            destroy() {},
          };
        },
      }));
    });

    afterEach(() => restoreFetch());

    function makeGeminiProvider(overrides: Record<string, unknown> = {}) {
      return createGeminiProvider({ apiKey: 'test-key', defaultModel: 'gemini-3-flash-preview', ...overrides });
    }

    /** Extract the JSON request body regardless of how the SDK invokes fetch (Request object or init.body) */
    async function readRequestBody(input: any, init: any): Promise<any> {
      if (init?.body) return JSON.parse(init.body as string);
      if (input instanceof Request) return JSON.parse(await input.clone().text());
      return null;
    }

    /** Build a mock Interactions API non-streaming response */
    function makeInteractionResponse(overrides: Record<string, unknown> = {}) {
      return new Response(
        JSON.stringify({
          id: 'v1_test',
          object: 'interaction',
          status: 'completed',
          model: 'gemini-3-flash-preview',
          output_text: '{"score": 8}',
          steps: [
            { type: 'thought', signature: 'sig_abc', summary: [{ type: 'text', text: 'Analyzing the image...' }] },
            { type: 'model_output', content: [{ type: 'text', text: '{"score": 8}' }] },
          ],
          usage: { total_input_tokens: 10, total_output_tokens: 20, total_thought_tokens: 5, total_tokens: 35 },
          ...overrides,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    /** Build a mock Interactions API SSE streaming response */
    function makeInteractionSSEResponse(events: Array<Record<string, unknown>>) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`));
          }
          controller.enqueue(encoder.encode('event: done\ndata: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    it('should create a provider with correct name and capabilities', () => {
      const provider = makeGeminiProvider();
      expect(provider.name).toBe('gemini(https://generativelanguage.googleapis.com)');
      expect(provider.capabilities.reasoning).toBe(true);
      expect(provider.capabilities.reasoningBudget).toBe(false);
      expect(provider.capabilities.vision).toBe(true);
      expect(provider.capabilities.streaming).toBe(true);
      expect(provider.capabilities.structuredOutput).toBe('json_schema');
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.chatStream).toBe('function');
    });

    it('should include custom baseURL in provider name', () => {
      const provider = makeGeminiProvider({ baseURL: 'https://proxy.example.com' });
      expect(provider.name).toBe('gemini(https://proxy.example.com)');
    });

    it('should send system_instruction, turns, store=false and pass image URLs directly', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider();
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You are a photography judge.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Rate this photo.' },
              { type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } },
            ],
          },
        ],
      });

      expect(capturedBody.model).toBe('gemini-3-flash-preview');
      expect(capturedBody.store).toBe(false);
      expect(capturedBody.system_instruction).toBe('You are a photography judge.');
      expect(capturedBody.input).toHaveLength(1);
      expect(capturedBody.input[0].role).toBe('user');
      expect(capturedBody.input[0].content).toEqual([
        { type: 'text', text: 'Rate this photo.' },
        // Public URL passed through directly — no client-side download
        { type: 'image', uri: 'https://example.com/photo.jpg' },
      ]);
    });

    it('should convert data: URLs to inline base64 image blocks and map assistant to model role', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider();
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
          },
          { role: 'assistant', content: '{"score": 5}' },
          { role: 'user', content: 'Try again.' },
        ],
      });

      expect(capturedBody.input[0].content).toEqual([{ type: 'image', data: 'aGVsbG8=', mime_type: 'image/png' }]);
      expect(capturedBody.input[1]).toEqual({ role: 'model', content: [{ type: 'text', text: '{"score": 5}' }] });
      expect(capturedBody.input[2].role).toBe('user');
    });

    it('should map reasoning effort to thinking_level with summaries and ignore budgetTokens', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider();
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
        reasoning: { effort: 'medium', budgetTokens: 4096 },
      });

      expect(capturedBody.generation_config.thinking_level).toBe('medium');
      expect(capturedBody.generation_config.thinking_summaries).toBe('auto');
      expect(capturedBody.generation_config.temperature).toBe(0.3);
      // budgetTokens is not supported by the Interactions API
      expect(capturedBody.generation_config.thinking_budget).toBeUndefined();
    });

    it('should map max/xhigh effort to thinking_level=high', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider();
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning: { effort: 'max' },
      });

      expect(capturedBody.generation_config.thinking_level).toBe('high');
    });

    it('should omit thinking fields when reasoning is not configured', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider();
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(capturedBody.generation_config).toBeUndefined();
    });

    it('should send response_format with schema for json_schema', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider();
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          name: 'test_schema',
          schema: { type: 'object', properties: { score: { type: 'number' } } },
          strict: true,
        },
      });

      expect(capturedBody.response_format).toEqual({
        type: 'text',
        mime_type: 'application/json',
        schema: { type: 'object', properties: { score: { type: 'number' } } },
      });
    });

    it('should send response_format without schema for json_object', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider();
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: { type: 'json_object' },
      });

      expect(capturedBody.response_format).toEqual({ type: 'text', mime_type: 'application/json' });
    });

    it('should merge defaultExtra and per-call extra into the request body', async () => {
      let capturedBody: any = null;
      mockFetch(async (input: any, init: any) => {
        capturedBody = await readRequestBody(input, init);
        return makeInteractionResponse();
      });

      const provider = makeGeminiProvider({ defaultExtra: { labels: { env: 'test' } } });
      await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'hi' }],
        extra: { service_tier: 'standard' },
      });

      expect(capturedBody.labels).toEqual({ env: 'test' });
      expect(capturedBody.service_tier).toBe('standard');
    });

    it('should parse output_text, thought summaries and usage from the response', async () => {
      mockFetch(async () => makeInteractionResponse());

      const provider = makeGeminiProvider();
      const resp = await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'rate this' }],
      });

      expect(resp.content).toBe('{"score": 8}');
      expect(resp.reasoning).toBe('Analyzing the image...');
      expect(resp.usage).toEqual({ inputTokens: 10, outputTokens: 20, reasoningTokens: 5 });
    });

    it('should tolerate thought steps without summaries and fall back to model_output text', async () => {
      mockFetch(async () =>
        makeInteractionResponse({
          output_text: undefined,
          steps: [
            { type: 'thought', signature: 'sig_only' },
            { type: 'model_output', content: [{ type: 'text', text: 'plain answer' }] },
          ],
        }),
      );

      const provider = makeGeminiProvider();
      const resp = await provider.chat({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(resp.content).toBe('plain answer');
      expect(resp.reasoning).toBeNull();
    });

    it('should throw api_error when the response carries no text at all', async () => {
      mockFetch(async () =>
        makeInteractionResponse({
          output_text: undefined,
          steps: [{ type: 'thought', signature: 'sig_only' }],
        }),
      );

      const provider = makeGeminiProvider();
      try {
        await provider.chat({ model: 'gemini-3-flash-preview', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('api_error');
        expect((error as ProviderError).message).toContain('Empty response');
      }
    });

    it('should classify 401 as auth_error', async () => {
      mockFetch(
        async () =>
          new Response(JSON.stringify({ error: { message: 'API key not valid', status: 'UNAUTHENTICATED' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      );

      const provider = makeGeminiProvider();
      try {
        await provider.chat({ model: 'gemini-3-flash-preview', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('auth_error');
        expect((error as ProviderError).statusCode).toBe(401);
      }
    });

    it('should classify 400 as api_error', async () => {
      mockFetch(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Invalid request', status: 'INVALID_ARGUMENT' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      );

      const provider = makeGeminiProvider();
      try {
        await provider.chat({ model: 'gemini-3-flash-preview', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('api_error');
      }
    });

    it('should classify fetch failures as network errors', async () => {
      mockFetch(async () => {
        throw new Error('fetch failed');
      });

      const provider = makeGeminiProvider();
      try {
        await provider.chat({ model: 'gemini-3-flash-preview', messages: [{ role: 'user', content: 'hi' }] });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).errorCode).toBe('network');
      }
    });

    it('should stream reasoning, content, partial and usage chunks', async () => {
      mockFetch(async () =>
        makeInteractionSSEResponse([
          { event_type: 'interaction.created', interaction: { id: 'v1_test', status: 'in_progress' } },
          {
            event_type: 'step.start',
            index: 0,
            // First summary block arrives embedded in step.start
            step: { type: 'thought', signature: '', summary: [{ type: 'text', text: 'Evaluating composition' }] },
          },
          {
            event_type: 'step.delta',
            index: 0,
            delta: { type: 'thought_summary', content: { type: 'text', text: ' and lighting' } },
          },
          { event_type: 'step.delta', index: 0, delta: { type: 'thought_signature', signature: 'sig_xyz' } },
          { event_type: 'step.stop', index: 0 },
          {
            event_type: 'step.start',
            index: 1,
            step: { type: 'model_output', content: [{ type: 'text', text: '{"sco' }] },
          },
          { event_type: 'step.delta', index: 1, delta: { type: 'text', text: 're": 8}' } },
          { event_type: 'step.stop', index: 1 },
          {
            event_type: 'interaction.completed',
            interaction: {
              id: 'v1_test',
              status: 'completed',
              usage: { total_input_tokens: 10, total_output_tokens: 20, total_thought_tokens: 5 },
            },
          },
        ]),
      );

      const provider = makeGeminiProvider();
      const chunks: Array<Record<string, unknown>> = [];
      for await (const chunk of provider.chatStream!({
        model: 'gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'rate this' }],
      })) {
        chunks.push(chunk as Record<string, unknown>);
      }

      const reasoning = chunks
        .filter((c) => typeof c.reasoning === 'string')
        .map((c) => c.reasoning)
        .join('');
      expect(reasoning).toBe('Evaluating composition and lighting');

      const content = chunks
        .filter((c) => typeof c.content === 'string')
        .map((c) => c.content)
        .join('');
      expect(content).toBe('{"score": 8}');

      // Incremental JSON partials are produced from streamed content
      expect(chunks.some((c) => c.partial && (c.partial as Record<string, unknown>).score === 8)).toBe(true);

      const usageChunks = chunks.filter((c) => c.usage);
      expect(usageChunks).toHaveLength(1);
      expect(usageChunks[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 20, reasoningTokens: 5 });
    });

    it('should throw ProviderError on stream error events', async () => {
      mockFetch(async () =>
        makeInteractionSSEResponse([
          { event_type: 'interaction.created', interaction: { id: 'v1_test', status: 'in_progress' } },
          { event_type: 'error', error: { code: 'https://example.com/errors/internal', message: 'stream exploded' } },
        ]),
      );

      const provider = makeGeminiProvider();
      try {
        const chunks = [];
        for await (const chunk of provider.chatStream!({
          model: 'gemini-3-flash-preview',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          chunks.push(chunk);
        }
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).message).toContain('stream exploded');
      }
    });
  });

  describe('createOpenAIResponsesProvider()', () => {
    it('should create a provider with minimal options', () => {
      const provider = createOpenAIResponsesProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'test-key',
      });
      expect(provider.name).toBe('openai-responses(https://api.openai.com/v1)');
      expect(provider.capabilities.reasoning).toBe(true);
      expect(provider.capabilities.streaming).toBe(true);
      expect(provider.capabilities.vision).toBe(true);
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.chatStream).toBe('function');
    });

    it('should create a provider with full options including headers and timeout', () => {
      const provider = createOpenAIResponsesProvider({
        baseURL: 'https://api.example.com/v1',
        apiKey: 'test-key',
        defaultModel: 'gpt-4o',
        headers: { 'X-Custom': 'value' },
        timeout: 30000,
      });
      expect(provider.name).toBe('openai-responses(https://api.example.com/v1)');
      expect(provider.capabilities.reasoning).toBe(true);
    });

    it('should expose structuredOutput=json_schema in capabilities', () => {
      const provider = createOpenAIResponsesProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'test-key',
      });
      expect(provider.capabilities.structuredOutput).toBe('json_schema');
    });
  });

  // ── OpenAI Responses structured output (buildRequestBody) ──
  describe('OpenAI Responses structured output (request body)', () => {
    afterEach(() => restoreFetch());

    function makeResponsesAPIResponse(outputText: string) {
      return new Response(
        JSON.stringify({
          id: 'resp_test',
          object: 'response',
          output_text: outputText,
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: outputText }] }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    it('should produce text.format with json_schema when response_format is json_schema', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input: any, init: any) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeResponsesAPIResponse('{"result": true}');
      });

      const provider = createOpenAIResponsesProvider({
        baseURL: 'https://mock-responses.test/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          name: 'test_schema',
          schema: { type: 'object', properties: { result: { type: 'boolean' } } },
          strict: true,
        },
      });

      expect(capturedBody.text).toBeDefined();
      expect(capturedBody.text.format.type).toBe('json_schema');
      expect(capturedBody.text.format.name).toBe('test_schema');
      expect(capturedBody.text.format.schema).toEqual({ type: 'object', properties: { result: { type: 'boolean' } } });
      expect(capturedBody.text.format.strict).toBe(true);
    });

    it('should produce text.format with json_object when response_format is json_object', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input: any, init: any) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeResponsesAPIResponse('{"result": true}');
      });

      const provider = createOpenAIResponsesProvider({
        baseURL: 'https://mock-responses.test/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: { type: 'json_object' },
      });

      expect(capturedBody.text).toBeDefined();
      expect(capturedBody.text.format).toEqual({ type: 'json_object' });
    });

    it('should NOT include text field when response_format is not provided', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input: any, init: any) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeResponsesAPIResponse('plain response');
      });

      const provider = createOpenAIResponsesProvider({
        baseURL: 'https://mock-responses.test/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(capturedBody.text).toBeUndefined();
    });

    it('should include description in json_schema format when provided', async () => {
      let capturedBody: any = null;

      mockFetch(async (_input: any, init: any) => {
        capturedBody = JSON.parse(init?.body as string);
        return makeResponsesAPIResponse('{"x": 1}');
      });

      const provider = createOpenAIResponsesProvider({
        baseURL: 'https://mock-responses.test/v1',
        apiKey: 'test-key',
      });

      await provider.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          name: 'test',
          schema: { type: 'object' },
          description: 'A test schema',
          strict: true,
        },
      });

      expect(capturedBody.text.format.description).toBe('A test schema');
    });
  });
});
