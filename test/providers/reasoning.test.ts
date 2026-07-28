// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import {
  getDefaultBudget,
  adaptReasoningParams,
  adaptResponsesReasoningParams,
  detectEndpointBehavior,
  extractReasoningContent,
  extractStreamReasoning,
  extractMiniMaxStreamReasoning,
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
    describe('when reasoning is undefined (explicit disable for thinking-default endpoints)', () => {
      it('returns empty object for openai endpoint (no default thinking)', () => {
        expect(adaptReasoningParams(undefined, 'openai')).toEqual({});
      });

      it('returns thinking disabled for kimi endpoint', () => {
        expect(adaptReasoningParams(undefined, 'kimi')).toEqual({ thinking: { type: 'disabled' } });
      });

      it('returns thinking disabled for mimo endpoint', () => {
        expect(adaptReasoningParams(undefined, 'mimo')).toEqual({ thinking: { type: 'disabled' } });
      });

      it('returns thinking disabled for zhipu endpoint', () => {
        expect(adaptReasoningParams(undefined, 'zhipu')).toEqual({ thinking: { type: 'disabled' } });
      });

      it('returns thinking disabled for minimax endpoint', () => {
        expect(adaptReasoningParams(undefined, 'minimax')).toEqual({ thinking: { type: 'disabled' } });
      });

      it('returns thinking disabled for volcanoark endpoint (Doubao defaults to thinking enabled)', () => {
        expect(adaptReasoningParams(undefined, 'volcanoark')).toEqual({ thinking: { type: 'disabled' } });
      });

      it('returns enable_thinking=false for dashscope endpoint', () => {
        expect(adaptReasoningParams(undefined, 'dashscope')).toEqual({ enable_thinking: false });
      });

      it('returns enable_thinking=false for qianfan endpoint', () => {
        expect(adaptReasoningParams(undefined, 'qianfan')).toEqual({ enable_thinking: false });
      });

      it('returns empty object for gemini endpoint (no explicit disable for Gemini)', () => {
        expect(adaptReasoningParams(undefined, 'gemini')).toEqual({});
      });

      it('returns reasoning_effort=none for grok endpoint (Grok defaults to low)', () => {
        expect(adaptReasoningParams(undefined, 'grok')).toEqual({ reasoning_effort: 'none' });
      });

      it('returns empty object for unknown endpoint', () => {
        expect(adaptReasoningParams(undefined, 'unknown' as never)).toEqual({});
      });
    });

    it('produces { reasoning_effort } for openai endpoint', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'openai')).toEqual({ reasoning_effort: 'medium' });
    });

    it('produces { reasoning_effort } for gemini endpoint (same format as OpenAI)', () => {
      const params: ChatReasoningParams = { effort: 'low' };
      expect(adaptReasoningParams(params, 'gemini')).toEqual({ reasoning_effort: 'low' });
    });

    it('produces { reasoning_effort } for gemini endpoint with high effort', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'gemini')).toEqual({ reasoning_effort: 'high' });
    });

    it('produces reasoning_effort + top-level thinking for deepseek endpoint', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'deepseek')).toEqual({
        reasoning_effort: 'high',
        thinking: { type: 'enabled' },
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

    it('produces mimo thinking enabled (Xiaomi MIMO, same format as Kimi)', () => {
      const params: ChatReasoningParams = { effort: 'high', budgetTokens: 9999 };
      expect(adaptReasoningParams(params, 'mimo')).toEqual({
        thinking: { type: 'enabled' },
      });
    });

    it('produces zhipu thinking enabled (Zhipu BigModel, same format as Kimi)', () => {
      const params: ChatReasoningParams = { effort: 'high', budgetTokens: 9999 };
      expect(adaptReasoningParams(params, 'zhipu')).toEqual({
        thinking: { type: 'enabled' },
      });
    });

    it('produces minimax thinking adaptive (MiniMax uses adaptive thinking mode)', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'minimax')).toEqual({
        thinking: { type: 'adaptive' },
      });
    });

    it('produces minimax thinking adaptive regardless of budgetTokens', () => {
      const params: ChatReasoningParams = { effort: 'medium', budgetTokens: 4096 };
      expect(adaptReasoningParams(params, 'minimax')).toEqual({
        thinking: { type: 'adaptive' },
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

    it('produces reasoning_effort for stepfun endpoint with low effort', () => {
      const params: ChatReasoningParams = { effort: 'low' };
      expect(adaptReasoningParams(params, 'stepfun')).toEqual({ reasoning_effort: 'low' });
    });

    it('produces reasoning_effort for stepfun endpoint with medium effort', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'stepfun')).toEqual({ reasoning_effort: 'medium' });
    });

    it('produces reasoning_effort for stepfun endpoint with high effort', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'stepfun')).toEqual({ reasoning_effort: 'high' });
    });

    it('maps minimal to low for stepfun (3-level: low/medium/high)', () => {
      const params: ChatReasoningParams = { effort: 'minimal' };
      expect(adaptReasoningParams(params, 'stepfun')).toEqual({ reasoning_effort: 'low' });
    });

    it('maps max to high for stepfun (3-level: low/medium/high)', () => {
      const params: ChatReasoningParams = { effort: 'max' };
      expect(adaptReasoningParams(params, 'stepfun')).toEqual({ reasoning_effort: 'high' });
    });

    it('produces enable_thinking for qianfan endpoint (ERNIE, no thinking_budget)', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'qianfan')).toEqual({ enable_thinking: true });
    });

    it('produces enable_thinking for qianfan even when budgetTokens provided (ERNIE ignores budget)', () => {
      const params: ChatReasoningParams = { effort: 'medium', budgetTokens: 4096 };
      expect(adaptReasoningParams(params, 'qianfan')).toEqual({ enable_thinking: true });
    });

    it('produces reasoning_effort=low for grok endpoint with low effort', () => {
      const params: ChatReasoningParams = { effort: 'low' };
      expect(adaptReasoningParams(params, 'grok')).toEqual({ reasoning_effort: 'low' });
    });

    it('produces reasoning_effort=medium for grok endpoint with medium effort', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      expect(adaptReasoningParams(params, 'grok')).toEqual({ reasoning_effort: 'medium' });
    });

    it('produces reasoning_effort=high for grok endpoint with high effort', () => {
      const params: ChatReasoningParams = { effort: 'high' };
      expect(adaptReasoningParams(params, 'grok')).toEqual({ reasoning_effort: 'high' });
    });

    it('maps minimal to none for grok (disables reasoning entirely)', () => {
      const params: ChatReasoningParams = { effort: 'minimal' };
      expect(adaptReasoningParams(params, 'grok')).toEqual({ reasoning_effort: 'none' });
    });

    it('maps max to high for grok (4-level: none/low/medium/high)', () => {
      const params: ChatReasoningParams = { effort: 'max' };
      expect(adaptReasoningParams(params, 'grok')).toEqual({ reasoning_effort: 'high' });
    });

    it('falls back to reasoning_effort for unknown endpoint', () => {
      const params: ChatReasoningParams = { effort: 'medium' };
      // Cast to bypass the exhaustive EndpointBehavior union for the default branch.
      const result = adaptReasoningParams(params, 'unknown' as never);
      expect(result).toEqual({ reasoning_effort: 'medium' });
    });
  });

  describe('adaptResponsesReasoningParams()', () => {
    describe('volcanoark behavior', () => {
      it('returns thinking disabled when reasoning is undefined (Ark defaults to enabled)', () => {
        expect(adaptResponsesReasoningParams(undefined, 'volcanoark')).toEqual({ thinking: { type: 'disabled' } });
      });

      it('returns thinking disabled for minimal effort', () => {
        expect(adaptResponsesReasoningParams({ effort: 'minimal' }, 'volcanoark')).toEqual({
          thinking: { type: 'disabled' },
        });
      });

      it('returns thinking disabled for none effort', () => {
        expect(adaptResponsesReasoningParams({ effort: 'none' }, 'volcanoark')).toEqual({
          thinking: { type: 'disabled' },
        });
      });

      it('returns thinking enabled + nested reasoning.effort for medium effort', () => {
        expect(adaptResponsesReasoningParams({ effort: 'medium' }, 'volcanoark')).toEqual({
          thinking: { type: 'enabled' },
          reasoning: { effort: 'medium' },
        });
      });

      it('passes max effort through (Ark supports max)', () => {
        expect(adaptResponsesReasoningParams({ effort: 'max' }, 'volcanoark')).toEqual({
          thinking: { type: 'enabled' },
          reasoning: { effort: 'max' },
        });
      });

      it('maps xhigh to max (Ark 5-level: minimal/low/medium/high/max)', () => {
        expect(adaptResponsesReasoningParams({ effort: 'xhigh' }, 'volcanoark')).toEqual({
          thinking: { type: 'enabled' },
          reasoning: { effort: 'max' },
        });
      });

      it('never includes summary (unsupported by Ark requests)', () => {
        const result = adaptResponsesReasoningParams({ effort: 'high', summary: 'detailed' }, 'volcanoark');
        expect(result).toEqual({
          thinking: { type: 'enabled' },
          reasoning: { effort: 'high' },
        });
      });
    });

    describe('mimo behavior', () => {
      it('returns reasoning effort none when reasoning is undefined (explicit disable)', () => {
        expect(adaptResponsesReasoningParams(undefined, 'mimo')).toEqual({ reasoning: { effort: 'none' } });
      });

      it('returns reasoning effort none for none effort', () => {
        expect(adaptResponsesReasoningParams({ effort: 'none' }, 'mimo')).toEqual({ reasoning: { effort: 'none' } });
      });

      it('maps minimal effort to none (MiMo 4-level: none/low/medium/high)', () => {
        expect(adaptResponsesReasoningParams({ effort: 'minimal' }, 'mimo')).toEqual({
          reasoning: { effort: 'none' },
        });
      });

      it('passes low/medium/high effort through', () => {
        expect(adaptResponsesReasoningParams({ effort: 'low' }, 'mimo')).toEqual({ reasoning: { effort: 'low' } });
        expect(adaptResponsesReasoningParams({ effort: 'medium' }, 'mimo')).toEqual({
          reasoning: { effort: 'medium' },
        });
        expect(adaptResponsesReasoningParams({ effort: 'high' }, 'mimo')).toEqual({ reasoning: { effort: 'high' } });
      });

      it('maps max effort to high', () => {
        expect(adaptResponsesReasoningParams({ effort: 'max' }, 'mimo')).toEqual({ reasoning: { effort: 'high' } });
      });

      it('maps xhigh effort to high', () => {
        expect(adaptResponsesReasoningParams({ effort: 'xhigh' }, 'mimo')).toEqual({ reasoning: { effort: 'high' } });
      });

      it('never includes summary (not a documented MiMo request parameter)', () => {
        const result = adaptResponsesReasoningParams({ effort: 'medium', summary: 'detailed' }, 'mimo');
        expect(result).toEqual({ reasoning: { effort: 'medium' } });
      });

      it('never includes the thinking toggle (MiMo uses reasoning.effort only)', () => {
        expect(adaptResponsesReasoningParams(undefined, 'mimo')).not.toHaveProperty('thinking');
        expect(adaptResponsesReasoningParams({ effort: 'high' }, 'mimo')).not.toHaveProperty('thinking');
      });
    });

    describe('openai behavior (default Responses shape)', () => {
      it('returns empty object when reasoning is undefined', () => {
        expect(adaptResponsesReasoningParams(undefined, 'openai')).toEqual({});
      });

      it('returns nested reasoning.effort without summary', () => {
        expect(adaptResponsesReasoningParams({ effort: 'medium' }, 'openai')).toEqual({
          reasoning: { effort: 'medium' },
        });
      });

      it('passes summary through when provided', () => {
        expect(adaptResponsesReasoningParams({ effort: 'high', summary: 'detailed' }, 'openai')).toEqual({
          reasoning: { effort: 'high', summary: 'detailed' },
        });
      });
    });
  });

  describe('detectEndpointBehavior()', () => {
    it('detects dashscope from dashscope.aliyuncs.com baseURL', () => {
      expect(detectEndpointBehavior('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('dashscope');
    });

    it('detects dashscope from dashscope-intl.aliyuncs.com baseURL (international)', () => {
      expect(detectEndpointBehavior('https://dashscope-intl.aliyuncs.com/compatible-mode/v1')).toBe('dashscope');
    });

    it('detects dashscope from token-plan maas.aliyuncs.com baseURL (Alibaba Token Plan)', () => {
      expect(detectEndpointBehavior('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')).toBe(
        'dashscope',
      );
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

    it('detects kimi from api.moonshot.ai baseURL (international)', () => {
      expect(detectEndpointBehavior('https://api.moonshot.ai/v1')).toBe('kimi');
    });

    it('detects mimo from xiaomimimo.com baseURL (Xiaomi MIMO uses thinking format)', () => {
      expect(detectEndpointBehavior('https://api.xiaomimimo.com/v1')).toBe('mimo');
    });

    it('detects openrouter from openrouter.ai baseURL', () => {
      expect(detectEndpointBehavior('https://openrouter.ai/api/v1')).toBe('openrouter');
    });

    it('detects volcanoark from ark.cn-beijing.volces.com baseURL', () => {
      expect(detectEndpointBehavior('https://ark.cn-beijing.volces.com/api/v3')).toBe('volcanoark');
    });

    it('detects zhipu from open.bigmodel.cn baseURL', () => {
      expect(detectEndpointBehavior('https://open.bigmodel.cn/api/paas/v4')).toBe('zhipu');
    });

    it('detects zhipu from bigmodel.cn baseURL', () => {
      expect(detectEndpointBehavior('https://bigmodel.cn/api/paas/v4')).toBe('zhipu');
    });

    it('detects minimax from api.minimaxi.com baseURL (domestic)', () => {
      expect(detectEndpointBehavior('https://api.minimaxi.com/v1')).toBe('minimax');
    });

    it('detects minimax from api.minimax.io baseURL (international)', () => {
      expect(detectEndpointBehavior('https://api.minimax.io/v1')).toBe('minimax');
    });

    it('detects qianfan from qianfan.baidubce.com baseURL', () => {
      expect(detectEndpointBehavior('https://qianfan.baidubce.com/v2')).toBe('qianfan');
    });

    it('detects stepfun from api.stepfun.com baseURL', () => {
      expect(detectEndpointBehavior('https://api.stepfun.com/v1')).toBe('stepfun');
    });

    it('detects stepfun from step_plan baseURL', () => {
      expect(detectEndpointBehavior('https://api.stepfun.com/step_plan/v1')).toBe('stepfun');
    });

    it('detects stepfun from api.stepfun.ai baseURL (international)', () => {
      expect(detectEndpointBehavior('https://api.stepfun.ai/v1')).toBe('stepfun');
    });

    it('detects gemini from generativelanguage.googleapis.com baseURL', () => {
      expect(detectEndpointBehavior('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe('gemini');
    });

    it('detects gemini from generativelanguage.googleapis.com without openai path', () => {
      expect(detectEndpointBehavior('https://generativelanguage.googleapis.com/v1beta')).toBe('gemini');
    });

    it('detects grok from api.x.ai baseURL', () => {
      expect(detectEndpointBehavior('https://api.x.ai/v1')).toBe('grok');
    });

    it('falls back to openai for unrecognized hosts', () => {
      expect(detectEndpointBehavior('https://api.openai.com/v1')).toBe('openai');
      expect(detectEndpointBehavior('https://example.test/v1')).toBe('openai');
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

    it('extracts reasoning from MiniMax reasoning_details array', () => {
      expect(
        extractReasoningContent({
          content: 'response',
          reasoning_details: [{ text: 'step 1: analyze' }, { text: 'step 2: conclude' }],
        }),
      ).toBe('step 1: analyzestep 2: conclude');
    });

    it('returns null for empty MiniMax reasoning_details array', () => {
      expect(extractReasoningContent({ reasoning_details: [] })).toBeNull();
    });

    it('prefers standard reasoning fields over MiniMax reasoning_details', () => {
      expect(
        extractReasoningContent({
          reasoning_content: 'preferred',
          reasoning_details: [{ text: 'fallback' }],
        }),
      ).toBe('preferred');
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

  describe('extractMiniMaxStreamReasoning()', () => {
    it('returns null when delta is null/undefined', () => {
      expect(extractMiniMaxStreamReasoning(null, 0)).toBeNull();
      expect(extractMiniMaxStreamReasoning(undefined, 0)).toBeNull();
    });

    it('returns null when no reasoning_details present', () => {
      expect(extractMiniMaxStreamReasoning({ content: 'hello' }, 0)).toBeNull();
    });

    it('returns null when reasoning_details is empty array', () => {
      expect(extractMiniMaxStreamReasoning({ reasoning_details: [] }, 0)).toBeNull();
    });

    it('extracts first chunk delta from cumulative text', () => {
      const result = extractMiniMaxStreamReasoning(
        { reasoning_details: [{ text: 'thinking step 1' }] },
        0,
      );
      expect(result).toEqual({ text: 'thinking step 1', cumulativeLength: 15 });
    });

    it('extracts incremental delta from cumulative text', () => {
      const result = extractMiniMaxStreamReasoning(
        { reasoning_details: [{ text: 'thinking step 1 and step 2' }] },
        15,
      );
      expect(result).toEqual({ text: ' and step 2', cumulativeLength: 26 });
    });

    it('returns null when cumulative text has not grown', () => {
      const result = extractMiniMaxStreamReasoning(
        { reasoning_details: [{ text: 'same text' }] },
        9,
      );
      expect(result).toBeNull();
    });

    it('returns null when reasoning_details item has no text field', () => {
      const result = extractMiniMaxStreamReasoning(
        { reasoning_details: [{ type: 'thinking' }] },
        0,
      );
      expect(result).toBeNull();
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

    it('reads reasoning_tokens from prompt_tokens_details (xAI/Grok style)', () => {
      const usage = extractTokenUsage({
        usage: {
          prompt_tokens: 41,
          completion_tokens: 15,
          prompt_tokens_details: { reasoning_tokens: 12 },
        },
      });
      expect(usage).toEqual({ inputTokens: 41, outputTokens: 15, reasoningTokens: 12 });
    });

    it('prefers completion_tokens_details over prompt_tokens_details for reasoning_tokens', () => {
      const usage = extractTokenUsage({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 8 },
          prompt_tokens_details: { reasoning_tokens: 5 },
        },
      });
      expect(usage?.reasoningTokens).toBe(8);
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
