// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { ProviderError } from '../../src/utils/errors.js';

/**
 * Helper: create an async generator that yields chunks sequentially.
 * Simulates the OpenAI SDK streaming response (AsyncIterable<ChatCompletionChunk>).
 */
async function* asyncIterableFrom<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * Helper: create an async generator that yields items then throws an error.
 */
async function* asyncIterableWithError<T>(items: T[], error: Error): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
  throw error;
}

/**
 * Helper: build a streaming chunk structure matching OpenAI SDK format.
 */
function makeStreamChunk(deltaFields: Record<string, unknown> | undefined, hasChoices = true) {
  if (!hasChoices) {
    return { choices: [] };
  }
  if (deltaFields === undefined) {
    return { choices: [{}] }; // choices[0] exists but no delta field
  }
  return {
    choices: [{ delta: deltaFields }],
  };
}

describe('OpenAI-Compat chatStream()', () => {
  // We mock the OpenAI client and vectorjson at the module level
  let mockCreate: ReturnType<typeof mock>;
  let mockParserInstance: {
    feed: ReturnType<typeof mock>;
    getValue: ReturnType<typeof mock>;
    destroy: ReturnType<typeof mock>;
  };
  let mockCreateParser: ReturnType<typeof mock>;
  let createOpenAICompatProvider: typeof import('../../src/providers/openai-compat.js').createOpenAICompatProvider;

  beforeEach(async () => {
    // Fresh mocks per test
    mockCreate = mock();
    mockParserInstance = {
      feed: mock(),
      getValue: mock(() => undefined),
      destroy: mock(),
    };
    mockCreateParser = mock(() => mockParserInstance);

    // Mock modules
    await import('../../src/providers/openai-compat.js');

    // We override the internal OpenAI client by mocking fetch and intercepting
    // Actually, let's mock at the module level using Bun's mock.module
    mock.module('vectorjson', () => ({
      createParser: mockCreateParser,
    }));

    mock.module('openai', () => ({
      default: class MockOpenAI {
        chat = {
          completions: {
            create: mockCreate,
          },
        };
      },
    }));

    // Re-import to pick up mocks - use dynamic import with cache busting
    const mod = await import('../../src/providers/openai-compat.js');
    createOpenAICompatProvider = mod.createOpenAICompatProvider;
  });

  function makeProvider() {
    return createOpenAICompatProvider({
      baseURL: 'https://mock-stream.test/v1',
      apiKey: 'test-key',
    });
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

  // ─── Test 1: reasoning_content field yields { thinking } ───
  it('should yield { thinking } for reasoning_content field in delta', async () => {
    const streamChunks = [
      makeStreamChunk({ reasoning_content: 'step 1: analyze' }),
      makeStreamChunk({ reasoning_content: 'step 2: conclude' }),
    ];
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    const result = await collectStream(provider);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ thinking: 'step 1: analyze' });
    expect(result[1]).toEqual({ thinking: 'step 2: conclude' });
  });

  // ─── Test 2: thinking field yields { thinking } ───
  it('should yield { thinking } for thinking field in delta', async () => {
    const streamChunks = [
      makeStreamChunk({ thinking: 'Let me think about this...' }),
      makeStreamChunk({ thinking: 'I see the pattern now.' }),
    ];
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    const result = await collectStream(provider);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ thinking: 'Let me think about this...' });
    expect(result[1]).toEqual({ thinking: 'I see the pattern now.' });
  });

  // ─── Test 3: content with parser returning partial ───
  it('should yield { content, partial } when parser.getValue() returns a value', async () => {
    const partialObj = { score: 8, dimensions: { composition: 9 } };
    mockParserInstance.getValue.mockReturnValue(partialObj);

    const streamChunks = [
      makeStreamChunk({ content: '{"score":' }),
      makeStreamChunk({ content: '8}' }),
    ];
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    const result = await collectStream(provider);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ content: '{"score":', partial: partialObj });
    expect(result[1]).toEqual({ content: '8}', partial: partialObj });
    expect(mockParserInstance.feed).toHaveBeenCalledTimes(2);
    expect(mockParserInstance.feed).toHaveBeenCalledWith('{"score":');
    expect(mockParserInstance.feed).toHaveBeenCalledWith('8}');
  });

  // ─── Test 4: content but parser returns undefined → only yield { content } ───
  it('should yield { content } only when parser.getValue() returns undefined', async () => {
    mockParserInstance.getValue.mockReturnValue(undefined);

    const streamChunks = [makeStreamChunk({ content: 'partial text' })];
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    const result = await collectStream(provider);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ content: 'partial text' });
    expect(result[0].partial).toBeUndefined();
  });

  // ─── Test 5: parser.getValue() throws → still yield { content } ───
  it('should yield { content } when parser.getValue() throws an exception', async () => {
    mockParserInstance.getValue.mockImplementation(() => {
      throw new Error('parse error');
    });

    const streamChunks = [makeStreamChunk({ content: 'broken json {' })];
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    const result = await collectStream(provider);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ content: 'broken json {' });
    expect(result[0].partial).toBeUndefined();
  });

  // ─── Test 6: empty delta (undefined) chunks are skipped ───
  it('should skip chunks where delta is undefined', async () => {
    const streamChunks = [
      makeStreamChunk(undefined), // no delta key
      makeStreamChunk({ content: 'hello' }),
      makeStreamChunk(undefined),
    ];
    mockParserInstance.getValue.mockReturnValue(undefined);
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    const result = await collectStream(provider);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ content: 'hello' });
  });

  // ─── Test 7: chunks with no choices are skipped ───
  it('should skip chunks with no choices', async () => {
    const streamChunks = [
      makeStreamChunk(undefined, false), // empty choices array
      makeStreamChunk({ content: 'world' }),
    ];
    mockParserInstance.getValue.mockReturnValue(undefined);
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    const result = await collectStream(provider);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ content: 'world' });
  });

  // ─── Test 8: non-ProviderError is wrapped as ProviderError ───
  it('should wrap non-ProviderError into ProviderError during stream', async () => {
    const networkError = new Error('network disconnected');
    mockCreate.mockResolvedValueOnce(asyncIterableWithError([], networkError));

    const provider = makeProvider();

    try {
      await collectStream(provider);
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      expect(pe.message).toContain('Stream call failed');
      expect(pe.message).toContain('network disconnected');
      expect(pe.errorCode).toBe('api_error');
    }
  });

  // ─── Test 9: ProviderError is re-thrown directly ───
  it('should re-throw ProviderError without wrapping', async () => {
    const originalError = new ProviderError('rate limited', 'test-provider', 'api_error', 429);
    mockCreate.mockResolvedValueOnce(asyncIterableWithError([], originalError));

    const provider = makeProvider();

    try {
      await collectStream(provider);
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      // Should be the exact same error, not wrapped
      expect(pe).toBe(originalError);
      expect(pe.message).toBe('rate limited');
      expect(pe.errorCode).toBe('api_error');
      expect(pe.statusCode).toBe(429);
    }
  });

  // ─── Test 10: parser.destroy() is called after successful stream ───
  it('should call parser.destroy() after stream completes successfully', async () => {
    const streamChunks = [
      makeStreamChunk({ content: 'done' }),
    ];
    mockParserInstance.getValue.mockReturnValue(undefined);
    mockCreate.mockResolvedValueOnce(asyncIterableFrom(streamChunks));

    const provider = makeProvider();
    await collectStream(provider);

    expect(mockParserInstance.destroy).toHaveBeenCalledTimes(1);
  });
});
