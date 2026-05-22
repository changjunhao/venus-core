// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import {
  getDefaultBudget,
  adaptReasoningParams,
  detectProviderStyle,
  extractReasoningContent,
  extractStreamReasoning,
  extractTokenUsage,
} from '../../src/providers/reasoning-adapter.js';
import type { ChatReasoningParams } from '../../src/types.js';

/**
 * These tests are intentionally focused on the branches that openai-compat
 * exercises during streaming and non-streaming flows, to cover the lines that
 * were previously not reached by the higher-level provider tests:
 *   - getDefaultBudget (line 25-30) — only triggered when an Anthropic-style
 *     reasoning request omits `budgetTokens`.
 *   - adaptReasoningParams (lines 50-55, 70-73) — Anthropic and Gemini styles.
 *   - extractTokenUsage (lines 154, 156) — both reasoning_tokens fallbacks.
 */
describe('reasoning-adapter', () => {
  describe('getDefaultBudget()', () => {
    it('returns 2048 for low effort', () => {
      expect(getDefaultBudget('low')).toBe(2048);
    });

    it('returns 8192 for medium effort', () => {
      expect(getDefaultBudget('medium')).toBe(8192);
    });

    it('returns 32768 for high effort', () => {
      expect(getDefaultBudget('high')).toBe(32768);
    });
  });

  describe('adaptReasoningParams()', () => {
    it('returns empty object when reasoning is undefined', () => {
      expect(adaptReasoningParams(undefined, 'openai')).toEqual({});
    });

    it('produces { reasoning_effort } for openai style', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'openai')).toEqual({ reasoning_effort: 'medium' });
    });

    it('produces { reasoning_effort } for deepseek style', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'deepseek')).toEqual({ reasoning_effort: 'high' });
    });

    it('produces anthropic thinking with explicit budgetTokens when provided', () => {
      const params: ChatReasoningParams = { effort: 'low', budgetTokens: 1024 };
      expect(adaptReasoningParams(params, 'anthropic')).toEqual({
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });
    });

    it('produces anthropic thinking with default budget when budgetTokens is omitted', () => {
      // This exercises the `getDefaultBudget(reasoning.effort)` fallback path.
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'anthropic')).toEqual({
        thinking: { type: 'enabled', budget_tokens: 8192 },
      });
    });

    it('produces qwen enable_thinking without thinking_budget when omitted', () => {
      const params: ChatReasoningParams = { effort: 'low' };
      expect(adaptReasoningParams(params, 'qwen')).toEqual({ enable_thinking: true });
    });

    it('produces qwen enable_thinking with thinking_budget when provided', () => {
      const params: ChatReasoningParams = { effort: 'low', budgetTokens: 4096 };
      expect(adaptReasoningParams(params, 'qwen')).toEqual({
        enable_thinking: true,
        thinking_budget: 4096,
      });
    });

    it('produces kimi thinking enabled (no budget supported)', () => {
      const params: ChatReasoningParams = { effort: 'high', budgetTokens: 9999 };
      expect(adaptReasoningParams(params, 'kimi')).toEqual({
        thinking: { type: 'enabled' },
      });
    });

    it('produces gemini thinkingConfig with thinkingLevel', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'gemini')).toEqual({
        thinkingConfig: { thinkingLevel: 'high' },
      });
    });

    it('falls back to reasoning_effort for unknown style', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      // Cast to bypass the exhaustive ProviderStyle union for the default branch.
      const result = adaptReasoningParams(params, 'unknown' as never);
      expect(result).toEqual({ reasoning_effort: 'medium' });
    });
  });

  describe('detectProviderStyle()', () => {
    it('detects qwen from dashscope baseURL', () => {
      expect(detectProviderStyle('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('qwen');
    });

    it('detects anthropic from anthropic baseURL', () => {
      expect(detectProviderStyle('https://api.anthropic.com/v1')).toBe('anthropic');
    });

    it('detects deepseek from deepseek baseURL', () => {
      expect(detectProviderStyle('https://api.deepseek.com/v1')).toBe('deepseek');
    });

    it('detects gemini from generativelanguage.googleapis.com baseURL', () => {
      expect(detectProviderStyle('https://generativelanguage.googleapis.com/v1beta')).toBe('gemini');
    });

    it('detects kimi from moonshot.cn baseURL', () => {
      expect(detectProviderStyle('https://api.moonshot.cn/v1')).toBe('kimi');
    });

    it('falls back to openai for unrecognized hosts', () => {
      expect(detectProviderStyle('https://api.openai.com/v1')).toBe('openai');
      expect(detectProviderStyle('https://example.test/v1')).toBe('openai');
    });
  });

  describe('extractReasoningContent()', () => {
    it('returns null when message is null', () => {
      expect(extractReasoningContent(null)).toBeNull();
    });

    it('returns null when message is undefined', () => {
      expect(extractReasoningContent(undefined)).toBeNull();
    });

    it('returns reasoning_content when present', () => {
      expect(extractReasoningContent({ reasoning_content: 'analysis here' })).toBe('analysis here');
    });

    it('returns reasoning when reasoning_content is missing', () => {
      expect(extractReasoningContent({ reasoning: 'inner monologue' })).toBe('inner monologue');
    });

    it('returns thinking when reasoning_content/reasoning are missing', () => {
      expect(extractReasoningContent({ thinking: 'pondering' })).toBe('pondering');
    });

    it('returns null when all reasoning fields are empty strings', () => {
      expect(extractReasoningContent({ reasoning_content: '', reasoning: '', thinking: '' })).toBeNull();
    });

    it('returns null when no recognized field exists', () => {
      expect(extractReasoningContent({ content: 'foo' })).toBeNull();
    });

    it('prefers reasoning_content over reasoning and thinking', () => {
      expect(
        extractReasoningContent({
          reasoning_content: 'A',
          reasoning: 'B',
          thinking: 'C',
        }),
      ).toBe('A');
    });
  });

  describe('extractStreamReasoning()', () => {
    it('returns null when delta is null/undefined', () => {
      expect(extractStreamReasoning(null)).toBeNull();
      expect(extractStreamReasoning(undefined)).toBeNull();
    });

    it('returns reasoning_content even when empty string (delta semantics)', () => {
      // Stream deltas can legitimately yield "" to signal the field is present;
      // the implementation only requires the field to be a string.
      expect(extractStreamReasoning({ reasoning_content: '' })).toBe('');
    });

    it('returns reasoning when reasoning_content is absent', () => {
      expect(extractStreamReasoning({ reasoning: 'step' })).toBe('step');
    });

    it('returns thinking when only thinking is present', () => {
      expect(extractStreamReasoning({ thinking: 'wire-format thinking' })).toBe('wire-format thinking');
    });

    it('returns null when no recognized fields exist on the delta', () => {
      expect(extractStreamReasoning({ content: 'foo' })).toBeNull();
    });
  });

  describe('extractTokenUsage()', () => {
    it('returns undefined for null/undefined input', () => {
      expect(extractTokenUsage(null)).toBeUndefined();
      expect(extractTokenUsage(undefined)).toBeUndefined();
    });

    it('returns undefined for non-object input', () => {
      expect(extractTokenUsage('string')).toBeUndefined();
      expect(extractTokenUsage(42)).toBeUndefined();
    });

    it('returns undefined when usage field is missing', () => {
      expect(extractTokenUsage({})).toBeUndefined();
    });

    it('returns undefined when all token counts are zero/missing', () => {
      expect(extractTokenUsage({ usage: {} })).toBeUndefined();
    });

    it('extracts prompt_tokens / completion_tokens (OpenAI style)', () => {
      const usage = extractTokenUsage({
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      });
      expect(usage).toEqual({ inputTokens: 12, outputTokens: 34 });
    });

    it('extracts input_tokens / output_tokens (Anthropic style)', () => {
      const usage = extractTokenUsage({
        usage: { input_tokens: 5, output_tokens: 7 },
      });
      expect(usage).toEqual({ inputTokens: 5, outputTokens: 7 });
    });

    it('reads reasoning_tokens from completion_tokens_details (line 154)', () => {
      const usage = extractTokenUsage({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 8 },
        },
      });
      expect(usage).toEqual({ inputTokens: 10, outputTokens: 20, reasoningTokens: 8 });
    });

    it('reads reasoning_tokens directly from usage as fallback (line 156)', () => {
      const usage = extractTokenUsage({
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          reasoning_tokens: 3,
        },
      });
      expect(usage).toEqual({ inputTokens: 1, outputTokens: 2, reasoningTokens: 3 });
    });

    it('returns reasoningTokens-only result when input/output are zero but reasoning is present', () => {
      // Hits the path where `inputTokens === 0 && outputTokens === 0` but reasoningTokens is defined,
      // so the early-return guard does NOT trigger.
      const usage = extractTokenUsage({
        usage: { reasoning_tokens: 100 },
      });
      expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, reasoningTokens: 100 });
    });

    it('prefers completion_tokens_details.reasoning_tokens over usage.reasoning_tokens', () => {
      const usage = extractTokenUsage({
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          completion_tokens_details: { reasoning_tokens: 99 },
          reasoning_tokens: 1,
        },
      });
      expect(usage?.reasoningTokens).toBe(99);
    });

    it('omits reasoningTokens field when not present', () => {
      const usage = extractTokenUsage({
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      });
      expect(usage).toEqual({ inputTokens: 1, outputTokens: 2 });
      expect(usage?.reasoningTokens).toBeUndefined();
    });
  });
});
