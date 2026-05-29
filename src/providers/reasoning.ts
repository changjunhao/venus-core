// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Reasoning Adapter
 *
 * Translates Venus's standardized `ChatReasoningParams` into the endpoint-specific
 * request fields required by each provider's OpenAI-compatible API, and conversely
 * extracts reasoning content / token usage from provider responses.
 *
 * The user-facing terminology is `reasoning`. The provider-specific output
 * field names below (e.g. `enable_thinking` for DashScope, `thinking` for Kimi)
 * are intentional — they reflect each vendor's actual API parameter names.
 *
 * ## EndpointBehavior (internal — NOT exported)
 *
 * Determined from `baseURL` at provider construction time via
 * `detectEndpointBehavior`. This is different from per-model routing:
 * within a single endpoint (e.g. DashScope), ALL models use the same
 * parameter format regardless of which upstream vendor trained them.
 */

import type { ChatReasoningParams, ReasoningEffort, TokenUsage } from '../types.js';

/**
 * Endpoint behavior classification used internally by OpenAI Chat provider.
 * NOT exported — consumers use `createOpenAIChatProvider` which auto-detects.
 */
type EndpointBehavior = 'openai' | 'dashscope' | 'deepseek' | 'kimi' | 'openrouter' | 'volcanoark';

/**
 * Default token budget for each reasoning effort level.
 * Used when a provider requires an explicit budget but the caller didn't supply one.
 */
export function getDefaultBudget(effort: ReasoningEffort): number {
  const budgets: Record<ReasoningEffort, number> = {
    minimal: 512,
    low: 2048,
    medium: 8192,
    high: 32768,
    max: 65536,
  };
  return budgets[effort];
}

/**
 * Translate Venus's reasoning params into endpoint-specific request fields.
 *
 * The returned object should be merged into the request body via `Object.assign`.
 */
export function adaptReasoningParams(
  reasoning: ChatReasoningParams | undefined,
  behavior: EndpointBehavior,
): Record<string, unknown> {
  if (!reasoning) return {};

  switch (behavior) {
    case 'openai':
      return { reasoning_effort: reasoning.effort };

    case 'dashscope':
      return {
        enable_thinking: true,
        ...(reasoning.budgetTokens ? { thinking_budget: reasoning.budgetTokens } : {}),
      };

    case 'deepseek':
      // DeepSeek requires both reasoning_effort (top-level) and
      // thinking toggle (via extra_body for native endpoint).
      return {
        reasoning_effort: reasoning.effort,
        extra_body: { thinking: { type: 'enabled' as const } },
      };

    case 'kimi':
      // Kimi (Moonshot) uses `thinking: { type: "enabled" }`. Budget tokens are not supported.
      return {
        thinking: { type: 'enabled' as const },
      };

    case 'openrouter':
      return {
        reasoning: {
          effort: reasoning.effort,
          ...(reasoning.budgetTokens ? { max_tokens: reasoning.budgetTokens } : {}),
          enabled: true,
        },
      };

    case 'volcanoark':
      // Volcano Ark (Doubao) controls thinking via two orthogonal parameters:
      //   thinking.type   — enabled/disabled toggle (always sent explicitly)
      //   reasoning_effort — effort level when enabled (minimal/low/medium/high/max)
      if (reasoning.effort === 'minimal') {
        return { thinking: { type: 'disabled' as const } };
      }
      return {
        thinking: { type: 'enabled' as const },
        reasoning_effort: reasoning.effort,
      };

    default:
      return { reasoning_effort: reasoning.effort };
  }
}

/**
 * Auto-detect endpoint behavior from its baseURL.
 * Falls back to 'openai' for any unrecognized host.
 *
 * @internal NOT exported — used only inside createOpenAIChatProvider
 */
export function detectEndpointBehavior(baseURL: string): EndpointBehavior {
  if (baseURL.includes('dashscope.aliyuncs.com')) return 'dashscope';
  if (baseURL.includes('openrouter.ai')) return 'openrouter';
  if (baseURL.includes('api.deepseek.com') || baseURL.includes('deepseek.com')) return 'deepseek';
  if (baseURL.includes('moonshot.cn') || baseURL.includes('api.moonshot.cn')) return 'kimi';
  if (baseURL.includes('ark.cn-beijing.volces.com')) return 'volcanoark';
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
