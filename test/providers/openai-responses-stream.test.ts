// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ProviderError, type ProviderErrorCode } from '../../src/utils/errors.js';
import type { ChatMessage } from '../../src/types.js';
import { mockFetch, restoreFetch } from '../helpers/mock-fetch.js';

// ─── SSE Response Helpers ───────────────────────────────────────────────────

/** Build a JSON Response mimicking the Responses API non-streaming format. */
function makeResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a minimal non-streaming Responses API response. */
function makeNonStreamResponse(outputText: string, extra: Record<string, unknown> = {}): Response {
  return makeResponse({
    id: 'resp_test',
    object: 'response',
    output_text: outputText,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: outputText }] }],
    usage: { input_tokens: 10, output_tokens: 20 },
    ...extra,
  });
}

/** Build an error Response with a JSON body. */
function makeErrorResponse(status: number, message: string): Response {
  return makeResponse({ error: { message, type: 'api_error' } }, status);
}

/** Build an SSE Response that yields events then closes. */
function makeSSEResponse(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Build an SSE Response that yields events, then errors. */
function makeSSEResponseWithError(events: Array<Record<string, unknown>>, error: Error): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
      }
      controller.error(error);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('OpenAI Responses Provider', () => {
  let mockParserInstance: {
    feed: ReturnType<typeof mock>;
    getValue: ReturnType<typeof mock>;
    destroy: ReturnType<typeof mock>;
  };
  let createOpenAIResponsesProvider: typeof import('../../src/providers/openai-responses.js').createOpenAIResponsesProvider;
  let extractResponsesTokenUsage: typeof import('../../src/providers/openai-responses.js').extractResponsesTokenUsage;
  let extractResponsesReasoning: typeof import('../../src/providers/openai-responses.js').extractResponsesReasoning;
  let capturedBody: any;

  beforeEach(async () => {
    // Fresh parser mock per test — uses bun:test mock() like openai-compat-stream.test.ts
    mockParserInstance = {
      feed: mock(),
      getValue: mock(() => undefined),
      destroy: mock(),
    };

    // Only mock vectorjson (not openai) to prevent module-cache leakage to other
    // test files (e.g. skeleton-providers.test.ts). The real OpenAI SDK is used
    // with globalThis.fetch replaced by mockFetch.
    mock.module('vectorjson', () => ({
      createParser: () => mockParserInstance,
    }));

    const mod = await import('../../src/providers/openai-responses.js');
    createOpenAIResponsesProvider = mod.createOpenAIResponsesProvider;
    extractResponsesTokenUsage = mod.extractResponsesTokenUsage;
    extractResponsesReasoning = mod.extractResponsesReasoning;

    // Default fetch mock — captures request body, returns empty response
    capturedBody = null;
    mockFetch(async (_input: any, init: any) => {
      if (init?.body) capturedBody = JSON.parse(init.body as string);
      return makeNonStreamResponse('');
    });
  });

  afterEach(() => {
    restoreFetch();
  });

  function makeProvider(overrides: Record<string, unknown> = {}) {
    return createOpenAIResponsesProvider({
      baseURL: 'https://mock-responses.test/v1',
      apiKey: 'test-key',
      ...overrides,
    });
  }

  function lastRequestBody(): Record<string, unknown> {
    expect(capturedBody).toBeDefined();
    return capturedBody;
  }

  async function collectStream(provider: ReturnType<typeof makeProvider>, params?: any) {
    const chunks: any[] = [];
    const stream = provider.chatStream!(
      params ?? { model: 'test-model', messages: [{ role: 'user' as const, content: 'hi' }] },
    );
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return chunks;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // extractResponsesTokenUsage
  // ═══════════════════════════════════════════════════════════════════════════
  describe('extractResponsesTokenUsage()', () => {
    it('returns input/output tokens for a normal usage object', () => {
      const result = extractResponsesTokenUsage({
        usage: { input_tokens: 10, output_tokens: 20 },
      });
      expect(result).toEqual({ inputTokens: 10, outputTokens: 20 });
    });

    it('includes reasoningTokens when output_tokens_details.reasoning_tokens is present', () => {
      const result = extractResponsesTokenUsage({
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          output_tokens_details: { reasoning_tokens: 20 },
        },
      });
      expect(result).toEqual({ inputTokens: 100, outputTokens: 50, reasoningTokens: 20 });
    });

    it('returns undefined when all token counts are zero', () => {
      const result = extractResponsesTokenUsage({
        usage: { input_tokens: 0, output_tokens: 0 },
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined for non-object response', () => {
      expect(extractResponsesTokenUsage(null)).toBeUndefined();
      expect(extractResponsesTokenUsage('bad')).toBeUndefined();
    });

    it('returns undefined when usage is missing', () => {
      expect(extractResponsesTokenUsage({})).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // extractResponsesReasoning
  // ═══════════════════════════════════════════════════════════════════════════
  describe('extractResponsesReasoning()', () => {
    it('joins reasoning summary text items with newlines', () => {
      const result = extractResponsesReasoning([
        { type: 'reasoning', summary: [{ text: 'step 1' }, { text: 'step 2' }] },
      ]);
      expect(result).toBe('step 1\nstep 2');
    });

    it('returns null when output contains no reasoning items', () => {
      const result = extractResponsesReasoning([
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
      ]);
      expect(result).toBeNull();
    });

    it('returns null when reasoning summary is empty', () => {
      const result = extractResponsesReasoning([{ type: 'reasoning', summary: [] }]);
      expect(result).toBeNull();
    });

    it('returns null for non-array input', () => {
      expect(extractResponsesReasoning({} as unknown[])).toBeNull();
    });

    it('ignores summary entries without string text', () => {
      const result = extractResponsesReasoning([
        { type: 'reasoning', summary: [{ text: 'keep' }, { notText: 'drop' }, null, 123] },
      ]);
      expect(result).toBe('keep');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // convertMessages & buildRequestBody
  // ═══════════════════════════════════════════════════════════════════════════
  describe('convertMessages() / buildRequestBody()', () => {
    it('extracts the first developer message as instructions', async () => {
      const provider = makeProvider({ defaultModel: 'fallback-model' });
      await provider.chat({
        model: '',
        messages: [
          { role: 'developer', content: 'Dev instruction' },
          { role: 'user', content: 'hi' },
        ],
      });

      const body = lastRequestBody();
      expect(body.model).toBe('fallback-model');
      expect(body.instructions).toBe('Dev instruction');
      expect(body.input).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('extracts the first system message as instructions and maps later developer/system to system role', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'developer', content: 'developer follow-up' },
          { role: 'user', content: 'hi' },
        ] as ChatMessage[],
      });

      const body = lastRequestBody();
      expect(body.instructions).toBe('system prompt');
      expect(body.input).toEqual([
        { role: 'system', content: 'developer follow-up' },
        { role: 'user', content: 'hi' },
      ]);
    });

    it('joins text parts into instructions when system content is an array', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'part1' },
              { type: 'text', text: 'part2' },
            ],
          },
          { role: 'user', content: 'hi' },
        ] as ChatMessage[],
      });

      const body = lastRequestBody();
      expect(body.instructions).toBe('part1part2');
    });

    it('converts user content parts to input_text / input_image', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'rate this photo' },
              { type: 'image_url', image_url: { url: 'https://img.test/a.jpg', detail: 'high' } },
            ],
          },
        ] as ChatMessage[],
      });

      expect(lastRequestBody().input).toEqual([
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'rate this photo' },
            { type: 'input_image', image_url: 'https://img.test/a.jpg', detail: 'high' },
          ],
        },
      ]);
    });

    it('omits detail on input_image when not provided', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [
          { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://img.test/b.jpg' } }] },
        ] as ChatMessage[],
      });

      expect(lastRequestBody().input).toEqual([
        { role: 'user', content: [{ type: 'input_image', image_url: 'https://img.test/b.jpg' }] },
      ]);
    });

    it('converts assistant content parts to output_text', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: [{ type: 'text', text: 'previous answer' }] },
        ] as ChatMessage[],
      });

      expect(lastRequestBody().input).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'output_text', text: 'previous answer' }] },
      ]);
    });

    it('passes temperature through when provided', async () => {
      const provider = makeProvider();
      await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5 });
      expect(lastRequestBody().temperature).toBe(0.5);
    });

    it('omits temperature when reasoning is configured', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
        reasoning: { effort: 'medium' },
      });
      expect(lastRequestBody().temperature).toBeUndefined();
    });

    it('passes reasoning params with optional summary', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning: { effort: 'high', summary: 'detailed' },
      });
      expect(lastRequestBody().reasoning).toEqual({ effort: 'high', summary: 'detailed' });
    });

    it('merges defaultExtra and per-call extra (per-call wins)', async () => {
      const provider = makeProvider({ defaultExtra: { seed: 42, top_p: 0.9 } });
      await provider.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        extra: { seed: 100 },
      });
      const body = lastRequestBody();
      expect(body.seed).toBe(100);
      expect(body.top_p).toBe(0.9);
    });

    it('sets stream:true for chatStream requests', async () => {
      mockFetch(async (_input: any, init: any) => {
        capturedBody = JSON.parse(init.body as string);
        return makeSSEResponse([]);
      });
      const provider = makeProvider();
      await collectStream(provider);
      expect(lastRequestBody().stream).toBe(true);
    });

    it('sends json_schema response_format correctly', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: {
          type: 'json_schema',
          name: 'score',
          schema: { type: 'object' },
          description: 'score schema',
          strict: false,
        },
      });
      expect(lastRequestBody().text).toEqual({
        format: {
          type: 'json_schema',
          name: 'score',
          schema: { type: 'object' },
          strict: false,
          description: 'score schema',
        },
      });
    });

    it('sends json_object response_format correctly', async () => {
      const provider = makeProvider();
      await provider.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        response_format: { type: 'json_object' },
      });
      expect(lastRequestBody().text).toEqual({ format: { type: 'json_object' } });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // classifyError
  // ═══════════════════════════════════════════════════════════════════════════
  describe('classifyError()', () => {
    async function expectChatError(expectedCode: ProviderErrorCode, expectedStatus?: number) {
      const provider = makeProvider();
      try {
        await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.errorCode).toBe(expectedCode);
        if (expectedStatus !== undefined) expect(pe.statusCode).toBe(expectedStatus);
      }
    }

    it('classifies 401 as auth_error', async () => {
      mockFetch(async () => makeErrorResponse(401, 'Unauthorized'));
      await expectChatError('auth_error', 401);
    });

    it('classifies 403 as auth_error', async () => {
      mockFetch(async () => makeErrorResponse(403, 'Forbidden'));
      await expectChatError('auth_error', 403);
    });

    it('classifies ETIMEDOUT code as timeout', async () => {
      mockFetch(() => {
        const e = new Error('timeout');
        (e as any).code = 'ETIMEDOUT';
        throw e;
      });
      await expectChatError('timeout');
    });

    it('classifies ESOCKETTIMEDOUT cause code as timeout', async () => {
      mockFetch(() => {
        const e = new Error('socket timeout');
        (e as any).code = 'ESOCKETTIMEDOUT';
        throw e;
      });
      await expectChatError('timeout');
    });

    it('classifies timeout message as timeout', async () => {
      mockFetch(() => {
        throw new Error('request timeout');
      });
      await expectChatError('timeout');
    });

    it('classifies ECONNREFUSED code as network', async () => {
      mockFetch(() => {
        const e = new Error('refused');
        (e as any).code = 'ECONNREFUSED';
        throw e;
      });
      await expectChatError('network');
    });

    it('classifies ENOTFOUND cause code as network', async () => {
      mockFetch(() => {
        const e = new Error('not found');
        (e as any).code = 'ENOTFOUND';
        throw e;
      });
      await expectChatError('network');
    });

    it('classifies fetch failed message as network', async () => {
      mockFetch(() => {
        throw new Error('fetch failed');
      });
      await expectChatError('network');
    });

    it('classifies Connection error message as network', async () => {
      mockFetch(() => {
        throw new Error('Connection error');
      });
      await expectChatError('network');
    });

    it('classifies 5xx status as api_error', async () => {
      mockFetch(async () => makeErrorResponse(500, 'Internal Server Error'));
      await expectChatError('api_error', 500);
    });

    it('classifies 3xx status (e.g. 300) as unknown', async () => {
      mockFetch(async () => makeErrorResponse(300, 'redirect'));
      await expectChatError('unknown');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // chat()
  // ═══════════════════════════════════════════════════════════════════════════
  describe('chat()', () => {
    it('returns content, reasoning and usage on success', async () => {
      mockFetch(async () =>
        makeNonStreamResponse('{"score":8}', {
          output: [
            { type: 'reasoning', summary: [{ text: 'step 1' }, { text: 'step 2' }] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"score":8}' }] },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            output_tokens_details: { reasoning_tokens: 20 },
          },
        }),
      );

      const provider = makeProvider();
      const result = await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

      expect(result.content).toBe('{"score":8}');
      expect(result.reasoning).toBe('step 1\nstep 2');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50, reasoningTokens: 20 });
      expect(result.raw).toBeDefined();
    });

    it('returns null reasoning and no usage when not present', async () => {
      mockFetch(async () =>
        makeNonStreamResponse('hello', {
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      );

      const provider = makeProvider();
      const result = await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

      expect(result.content).toBe('hello');
      expect(result.reasoning).toBeNull();
      expect(result.usage).toBeUndefined();
    });

    it('falls back to empty content when output_text is missing', async () => {
      mockFetch(async () =>
        makeResponse({
          object: 'response',
          output: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );

      const provider = makeProvider();
      const result = await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      expect(result.content).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // chatStream()
  // ═══════════════════════════════════════════════════════════════════════════
  describe('chatStream()', () => {
    it('yields { content, partial } when parser.getValue() returns a value', async () => {
      const partialObj = { score: 8 };
      mockParserInstance.getValue.mockReturnValue(partialObj);

      mockFetch(async () => makeSSEResponse([{ type: 'response.output_text.delta', delta: '{"score":8}' }]));

      const provider = makeProvider();
      const result = await collectStream(provider);

      expect(result).toEqual([{ content: '{"score":8}', partial: partialObj }]);
      expect(mockParserInstance.feed).toHaveBeenCalledTimes(1);
      expect(mockParserInstance.feed).toHaveBeenCalledWith('{"score":8}');
    });

    it('yields { content } when parser.getValue() returns undefined', async () => {
      mockParserInstance.getValue.mockReturnValue(undefined);

      mockFetch(async () => makeSSEResponse([{ type: 'response.output_text.delta', delta: 'partial text' }]));

      const provider = makeProvider();
      const result = await collectStream(provider);

      expect(result).toEqual([{ content: 'partial text' }]);
      expect(result[0].partial).toBeUndefined();
    });

    it('yields { content } when parser.getValue() throws', async () => {
      mockParserInstance.getValue.mockImplementation(() => {
        throw new Error('parse error');
      });

      mockFetch(async () => makeSSEResponse([{ type: 'response.output_text.delta', delta: 'broken {' }]));

      const provider = makeProvider();
      const result = await collectStream(provider);

      expect(result).toEqual([{ content: 'broken {' }]);
      expect(result[0].partial).toBeUndefined();
    });

    it('skips empty text deltas', async () => {
      mockParserInstance.getValue.mockReturnValue(undefined);

      mockFetch(async () =>
        makeSSEResponse([
          { type: 'response.output_text.delta', delta: '' },
          { type: 'response.output_text.delta', delta: 'x' },
        ]),
      );

      const provider = makeProvider();
      const result = await collectStream(provider);

      expect(result).toEqual([{ content: 'x' }]);
    });

    it('yields { reasoning } for reasoning_summary_text.delta events', async () => {
      mockFetch(async () =>
        makeSSEResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'thinking...' },
          { type: 'response.reasoning_summary_text.delta', delta: 'done' },
        ]),
      );

      const provider = makeProvider();
      const result = await collectStream(provider);

      expect(result).toEqual([{ reasoning: 'thinking...' }, { reasoning: 'done' }]);
    });

    it('throws ProviderError on response.error event and calls destroy', async () => {
      // Send response.error WITHOUT an "error" field so the SDK yields the event
      // directly (the SDK checks data.error and throws APIError if truthy).
      // Without the error field, the event reaches our source code's handler.
      mockFetch(async () => makeSSEResponse([{ type: 'response.error' }]));

      const provider = makeProvider();
      try {
        await collectStream(provider);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.message).toContain('Unknown Responses API error');
      }
      expect(mockParserInstance.destroy).toHaveBeenCalledTimes(1);
    });

    it('throws ProviderError on response.failed event with the nested error message', async () => {
      mockFetch(async () =>
        makeSSEResponse([{ type: 'response.failed', response: { error: { message: 'model overloaded' } } }]),
      );

      const provider = makeProvider();
      try {
        await collectStream(provider);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.message).toContain('model overloaded');
      }
      expect(mockParserInstance.destroy).toHaveBeenCalledTimes(1);
    });

    it('throws ProviderError on a top-level error event', async () => {
      // Top-level error events carry `message` directly on the event
      mockFetch(async () => makeSSEResponse([{ type: 'error', message: 'stream exploded' }]));

      const provider = makeProvider();
      try {
        await collectStream(provider);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.message).toContain('stream exploded');
      }
      expect(mockParserInstance.destroy).toHaveBeenCalledTimes(1);
    });

    it('classifies initial stream request failures (e.g. network) as ProviderError', async () => {
      mockFetch(() => {
        throw new Error('fetch failed');
      });

      const provider = makeProvider();
      try {
        await collectStream(provider);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.errorCode).toBe('network');
      }
    });

    it('yields { usage } on response.completed when includeUsage is true', async () => {
      mockParserInstance.getValue.mockReturnValue(undefined);

      mockFetch(async () =>
        makeSSEResponse([
          { type: 'response.output_text.delta', delta: 'hi' },
          {
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 10,
                output_tokens: 20,
                output_tokens_details: { reasoning_tokens: 5 },
              },
            },
          },
        ]),
      );

      const provider = makeProvider();
      const result = await collectStream(provider);

      expect(result).toEqual([{ content: 'hi' }, { usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5 } }]);
    });

    it('does not yield usage when includeUsage is false', async () => {
      mockParserInstance.getValue.mockReturnValue(undefined);

      mockFetch(async () =>
        makeSSEResponse([
          { type: 'response.output_text.delta', delta: 'hi' },
          {
            type: 'response.completed',
            response: { usage: { input_tokens: 10, output_tokens: 20 } },
          },
        ]),
      );

      const provider = makeProvider({ includeUsage: false });
      const result = await collectStream(provider);

      expect(result).toEqual([{ content: 'hi' }]);
    });

    it('yields { usage } on response.incomplete (truncated stream)', async () => {
      mockParserInstance.getValue.mockReturnValue(undefined);

      mockFetch(async () =>
        makeSSEResponse([
          { type: 'response.output_text.delta', delta: 'partial' },
          {
            type: 'response.incomplete',
            response: { usage: { input_tokens: 7, output_tokens: 3 } },
          },
        ]),
      );

      const provider = makeProvider();
      const result = await collectStream(provider);

      expect(result).toEqual([{ content: 'partial' }, { usage: { inputTokens: 7, outputTokens: 3 } }]);
    });

    it('wraps non-ProviderError stream errors in ProviderError', async () => {
      mockFetch(async () => makeSSEResponseWithError([], new Error('network boom')));

      const provider = makeProvider();
      try {
        await collectStream(provider);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.errorCode).toBe('api_error');
        expect(pe.message).toContain('network boom');
      }
      expect(mockParserInstance.destroy).toHaveBeenCalledTimes(1);
    });

    it('re-throws ProviderError from the stream without wrapping', async () => {
      const original = new ProviderError('rate limited', 'openai-responses(...)', 'api_error', 429);
      mockFetch(async () => makeSSEResponseWithError([], original));

      const provider = makeProvider();
      try {
        await collectStream(provider);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBe(original);
      }
      expect(mockParserInstance.destroy).toHaveBeenCalledTimes(1);
    });

    it('calls parser.destroy() after a successful stream', async () => {
      mockParserInstance.getValue.mockReturnValue(undefined);

      mockFetch(async () => makeSSEResponse([{ type: 'response.output_text.delta', delta: 'done' }]));

      const provider = makeProvider();
      await collectStream(provider);

      expect(mockParserInstance.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
