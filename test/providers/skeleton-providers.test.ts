import { describe, it, expect } from 'bun:test';
import { createAnthropicProvider } from '../../src/providers/anthropic.js';
import { createGeminiProvider } from '../../src/providers/gemini.js';
import { createOpenAIResponsesProvider } from '../../src/providers/openai-responses.js';

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
    it('should throw "not yet implemented" error', () => {
      expect(() =>
        createOpenAIResponsesProvider({
          baseURL: 'https://api.openai.com/v1',
          apiKey: 'test-key',
        }),
      ).toThrow('OpenAI Responses provider is not yet implemented');
    });

    it('should throw with full options including headers and timeout', () => {
      expect(() =>
        createOpenAIResponsesProvider({
          baseURL: 'https://api.example.com/v1',
          apiKey: 'test-key',
          defaultModel: 'gpt-4o',
          headers: { 'X-Custom': 'value' },
          timeout: 30000,
        }),
      ).toThrow('OpenAI Responses provider is not yet implemented');
    });
  });
});
