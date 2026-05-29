// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import {
  getDefaultBudget,
  adaptReasoningParams,
  detectEndpointBehavior,
  extractReasoningContent,
  extractStreamReasoning,
  extractTokenUsage,
} from '../../src/providers/reasoning.js';
import type { ChatReasoningParams } from '../../src/types.js';

describe('reasoning', () => {
  describe('getDefaultBudget()', () => {
    it('returns 512 for minimal effort', () => {
      expect(getDefaultBudget('minimal')).toBe(512);
    });

    it('returns 2048 for low effort', () => {
      expect(getDefaultBudget('low')).toBe(2048);
    });

    it('returns 8192 for medium effort', () => {
      expect(getDefaultBudget('medium')).toBe(8192);
    });

    it('returns 32768 for high effort', () => {
      expect(getDefaultBudget('high')).toBe(32768);
    });

    it('returns 65536 for max effort', () => {
      expect(getDefaultBudget('max')).toBe(65536);
    });
  });

  describe('adaptReasoningParams()', () => {
    it('returns empty object when reasoning is undefined', () => {
      expect(adaptReasoningParams(undefined, 'openai')).toEqual({});
    });

    it('produces { reasoning_effort } for openai endpoint', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'openai')).toEqual({ reasoning_effort: 'medium' });
    });

    it('produces reasoning_effort + extra_body.thinking for deepseek endpoint', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'deepseek')).toEqual({
        reasoning_effort: 'high',
        extra_body: { thinking: { type: 'enabled' } },
      });
    });

    it('produces dashscope enable_thinking without thinking_budget when omitted', () => {
      const params: ChatReasoningParams = { effort: 'low' };
      expect(adaptReasoningParams(params, 'dashscope')).toEqual({ enable_thinking: true });
    });

    it('produces dashscope enable_thinking with thinking_budget when provided', () => {
      const params: ChatReasoningParams = { effort: 'low', budgetTokens: 4096 };
      expect(adaptReasoningParams(params, 'dashscope')).toEqual({
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

    it('produces openrouter reasoning object with effort', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'openrouter')).toEqual({
        reasoning: { effort: 'medium', enabled: true },
      });
    });

    it('produces openrouter reasoning object with max_tokens when budgetTokens provided', () => {
      const params: ChatReasoningParams = { effort: 'high', budgetTokens: 8192 };
      expect(adaptReasoningParams(params, 'openrouter')).toEqual({
        reasoning: { effort: 'high', max_tokens: 8192, enabled: true },
      });
    });

    it('produces thinking disabled for volcanoark minimal effort', () => {
      const params: ChatReasoningParams = { effort: 'minimal' };
      expect(adaptReasoningParams(params, 'volcanoark')).toEqual({ thinking: { type: 'disabled' } });
    });

    it('produces thinking enabled + reasoning_effort for volcanoark medium effort', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'volcanoark')).toEqual({
        thinking: { type: 'enabled' },
        reasoning_effort: 'medium',
      });
    });

    it('produces thinking enabled + reasoning_effort for volcanoark max effort', () => {
      const params: ChatReasoningParams = { effort: 'max' };
      expect(adaptReasoningParams(params, 'volcanoark')).toEqual({
        thinking: { type: 'enabled' },
        reasoning_effort: 'max',
      });
    });

    it('falls back to reasoning_effort for unknown endpoint', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      // Cast to bypass the exhaustive EndpointBehavior union for the default branch.
      const result = adaptReasoningParams(params, 'unknown' as never);
      expect(result).toEqual({ reasoning_effort: 'medium' });
    });
  });

  describe('detectEndpointBehavior()', () => {
    it('detects dashscope from dashscope.aliyuncs.com baseURL', () => {
      expect(detectEndpointBehavior('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('dashscope');
    });

    it('detects deepseek from api.deepseek.com baseURL', () => {
      expect(detectEndpointBehavior('https://api.deepseek.com/v1')).toBe('deepseek');
    });

    it('detects deepseek from generic deepseek.com baseURL', () => {
      expect(detectEndpointBehavior('https://deepseek.com/api')).toBe('deepseek');
    });

    it('detects kimi from moonshot.cn baseURL', () => {
      expect(detectEndpointBehavior('https://api.moonshot.cn/v1')).toBe('kimi');
    });

    it('detects kimi from moonshot.cn subdomain', () => {
      expect(detectEndpointBehavior('https://api.moonshot.cn/v1')).toBe('kimi');
    });

    it('detects openrouter from openrouter.ai baseURL', () => {
      expect(detectEndpointBehavior('https://openrouter.ai/api/v1')).toBe('openrouter');
    });

    it('detects volcanoark from ark.cn-beijing.volces.com baseURL', () => {
      expect(detectEndpointBehavior('https://ark.cn-beijing.volces.com/api/v3')).toBe('volcanoark');
    });

    it('falls back to openai for unrecognized hosts', () => {
      expect(detectEndpointBehavior('https://api.openai.com/v1')).toBe('openai');
      expect(detectEndpointBehavior('https://example.test/v1')).toBe('openai');
      expect(detectEndpointBehavior('https://generativelanguage.googleapis.com/v1beta')).toBe('openai');
      expect(detectEndpointBehavior('https://api.anthropic.com/v1')).toBe('openai');
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

    it('reads reasoning_tokens from completion_tokens_details', () => {
      const usage = extractTokenUsage({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 8 },
        },
      });
      expect(usage).toEqual({ inputTokens: 10, outputTokens: 20, reasoningTokens: 8 });
    });

    it('reads reasoning_tokens directly from usage as fallback', () => {
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
