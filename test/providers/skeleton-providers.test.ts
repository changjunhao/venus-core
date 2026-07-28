import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';
import { createAnthropicProvider } from '../../src/providers/anthropic.js';
import { createGeminiProvider } from '../../src/providers/gemini.js';
import { createOpenAIResponsesProvider } from '../../src/providers/openai-responses.js';
import { ProviderError } from '../../src/utils/errors.js';
import { mockFetch, restoreFetch } from '../helpers/mock-fetch.js';

describe('Skeleton Providers', () => {
  describe('createAnthropicProvider()', () => {
    it('should throw "not yet implemented" error', () => {
      expect(() => createAnthropicProvider({ apiKey: 'test-key' })).toThrow(
        'Anthropic provider is not yet implemented',
      );
    });

    it('should throw with default model option', () => {
      expect(() =>
        createAnthropicProvider({
          apiKey: 'test-key',
          defaultModel: 'claude-sonnet-4-20250514',
        }),
      ).toThrow('Anthropic provider is not yet implemented');
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
