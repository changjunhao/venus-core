import { describe, it, expect, afterEach } from 'bun:test';
import { createAnthropicProvider } from '../../src/providers/anthropic.js';
import { createGeminiProvider } from '../../src/providers/gemini.js';
import { createOpenAIResponsesProvider } from '../../src/providers/openai-responses.js';
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
    it('should throw "not yet implemented" error', () => {
      expect(() => createGeminiProvider({ apiKey: 'test-key' })).toThrow('Gemini provider is not yet implemented');
    });

    it('should throw with default model option', () => {
      expect(() =>
        createGeminiProvider({
          apiKey: 'test-key',
          defaultModel: 'gemini-2.5-flash',
        }),
      ).toThrow('Gemini provider is not yet implemented');
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
