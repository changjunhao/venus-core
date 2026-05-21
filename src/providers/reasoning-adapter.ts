// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Reasoning Adapter
 *
 * Translates Venus's standardized `ChatReasoningParams` into the vendor-specific
 * request fields required by each provider style (OpenAI, Anthropic, Qwen, etc.),
 * and conversely extracts reasoning content / token usage from provider responses.
 *
 * The user-facing terminology is `reasoning`. The provider-specific output
 * field names below (e.g. `enable_thinking` for Qwen, `thinking` for Anthropic)
 * are intentional — they reflect each vendor's actual API parameter names.
 */

import type { ChatReasoningParams, ReasoningEffort, TokenUsage } from '../types.js';

/** Supported provider API styles */
export type ProviderStyle = 'openai' | 'anthropic' | 'qwen' | 'deepseek' | 'gemini' | 'kimi';

/**
 * Default token budget for each reasoning effort level.
 * Used when a provider requires an explicit budget but the caller didn't supply one.
 */
export function getDefaultBudget(effort: ReasoningEffort): number {
  const budgets: Record<ReasoningEffort, number> = {
    low: 2048,
    medium: 8192,
    high: 32768,
  };
  return budgets[effort];
}

/**
 * Translate Venus's reasoning params into provider-specific request fields.
 *
 * The returned object should be merged into the request body via `Object.assign`.
 */
export function adaptReasoningParams(
  reasoning: ChatReasoningParams | undefined,
  style: ProviderStyle,
): Record<string, unknown> {
  if (!reasoning) return {};

  switch (style) {
    case 'openai':
    case 'deepseek':
      return { reasoning_effort: reasoning.effort };

    case 'anthropic':
      return {
        thinking: {
          type: 'enabled',
          budget_tokens: reasoning.budgetTokens ?? getDefaultBudget(reasoning.effort),
        },
      };

    case 'qwen':
      return {
        enable_thinking: true,
        ...(reasoning.budgetTokens && { thinking_budget: reasoning.budgetTokens }),
      };

    case 'kimi':
      // Kimi (Moonshot) uses `thinking: { type: "enabled" }`. Budget tokens are not supported.
      return {
        thinking: { type: 'enabled' },
      };

    case 'gemini':
      return {
        thinkingConfig: { thinkingLevel: reasoning.effort },
      };

    default:
      return { reasoning_effort: reasoning.effort };
  }
}

/**
 * Auto-detect a provider style from its baseURL.
 * Falls back to 'openai' for any unrecognized host.
 */
export function detectProviderStyle(baseURL: string): ProviderStyle {
  if (baseURL.includes('dashscope.aliyuncs.com')) return 'qwen';
  if (baseURL.includes('anthropic')) return 'anthropic';
  if (baseURL.includes('deepseek')) return 'deepseek';
  if (baseURL.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (baseURL.includes('moonshot.cn')) return 'kimi';
  return 'openai';
}

/**
 * Extract reasoning content from a non-streaming chat response message.
 *
 * Inspects common vendor field names in priority order:
 *   - `reasoning_content`  (OpenAI / DeepSeek / Qwen reasoning)
 *   - `reasoning`          (OpenAI Responses API style)
 *   - `thinking`           (Anthropic / older vendor variants)
 */
export function extractReasoningContent(message: Record<string, unknown> | null | undefined): string | null {
  if (!message) return null;

  if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    return message.reasoning_content;
  }
  if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
    return message.reasoning;
  }
  if (typeof message.thinking === 'string' && message.thinking.length > 0) {
    return message.thinking;
  }
  return null;
}

/**
 * Extract a reasoning delta from a streaming chunk's `delta` payload.
 *
 * Returns `null` when no reasoning content is present in the chunk.
 */
export function extractStreamReasoning(delta: Record<string, unknown> | null | undefined): string | null {
  if (!delta) return null;

  if (typeof delta.reasoning_content === 'string') return delta.reasoning_content;
  if (typeof delta.reasoning === 'string') return delta.reasoning;
  if (typeof delta.thinking === 'string') return delta.thinking;
  return null;
}

/**
 * Extract token usage statistics from a provider response.
 *
 * Supports OpenAI-style `usage` objects with optional
 * `completion_tokens_details.reasoning_tokens` (OpenAI Reasoning API).
 */
export function extractTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const usage = r.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  const inputTokens =
    (typeof usage.prompt_tokens === 'number' && usage.prompt_tokens) ||
    (typeof usage.input_tokens === 'number' && usage.input_tokens) ||
    0;
  const outputTokens =
    (typeof usage.completion_tokens === 'number' && usage.completion_tokens) ||
    (typeof usage.output_tokens === 'number' && usage.output_tokens) ||
    0;

  let reasoningTokens: number | undefined;
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  if (details && typeof details.reasoning_tokens === 'number') {
    reasoningTokens = details.reasoning_tokens;
  } else if (typeof usage.reasoning_tokens === 'number') {
    reasoningTokens = usage.reasoning_tokens;
  }

  if (inputTokens === 0 && outputTokens === 0 && reasoningTokens === undefined) {
    return undefined;
  }

  const result: TokenUsage = { inputTokens, outputTokens };
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  return result;
}
