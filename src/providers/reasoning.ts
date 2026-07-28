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
 * ## EndpointBehavior (internal)
 *
 * Determined from `baseURL` at provider construction time via
 * `detectEndpointBehavior`. This is different from per-model routing:
 * within a single endpoint (e.g. DashScope), ALL models use the same
 * parameter format regardless of which upstream vendor trained them.
 *
 * The hostname → behavior table lives in the generated `endpoint-hosts.ts`
 * (derived from models.dev api.json via `bun run generate:endpoints`).
 */

import type { ChatReasoningParams, ReasoningEffort, TokenUsage } from '../types.js';
import { ENDPOINT_HOSTS } from './endpoint-hosts.js';

/**
 * Endpoint behavior classification used internally by OpenAI Chat provider.
 * Exported as a type only for the generated `endpoint-hosts.ts` table —
 * consumers use `createOpenAIChatProvider` which auto-detects.
 */
export type EndpointBehavior = 'openai' | 'dashscope' | 'deepseek' | 'gemini' | 'grok' | 'kimi' | 'mimo' | 'minimax' | 'openrouter' | 'qianfan' | 'stepfun' | 'volcanoark' | 'zhipu';

/**
 * Default token budget for each reasoning effort level.
 * Used when a provider requires an explicit budget but the caller didn't supply one.
 */
export function getDefaultBudget(effort: ReasoningEffort): number {
  const budgets: Record<ReasoningEffort, number> = {
    none: 0,
    minimal: 512,
    low: 2048,
    medium: 8192,
    high: 32768,
    max: 65536,
    xhigh: 65536,
  };
  return budgets[effort];
}

/**
 * Translate Venus's reasoning params into endpoint-specific request fields.
 *
 * Handles both the "reasoning configured" and "reasoning not configured" cases:
 * - When reasoning IS configured → sends endpoint-specific enable fields
 * - When reasoning is NOT configured → sends endpoint-specific disable fields
 *   for endpoints whose models default to thinking enabled (DashScope, Qianfan,
 *   Kimi, MIMO, Zhipu, MiniMax, Volcano Ark), ensuring predictable engine
 *   behavior regardless of model defaults.
 *
 * The returned object should be merged into the request body via `Object.assign`.
 */
export function adaptReasoningParams(
  reasoning: ChatReasoningParams | undefined,
  behavior: EndpointBehavior,
): Record<string, unknown> {
  if (!reasoning) {
    // Explicitly disable thinking for endpoints whose models default to enabled.
    switch (behavior) {
      case 'kimi':
      case 'mimo':
      case 'zhipu':
      case 'minimax':
      case 'volcanoark':
        // Volcano Ark (Doubao) also defaults to thinking enabled when `thinking` is omitted.
        return { thinking: { type: 'disabled' as const } };
      case 'dashscope':
      case 'qianfan':
        return { enable_thinking: false };
      case 'grok':
        // Grok reasoning models default to reasoning_effort='low'; use 'none' to fully disable.
        return { reasoning_effort: 'none' };
      default:
        return {};
    }
  }

  switch (behavior) {
    case 'openai':
    case 'gemini':
      // Gemini OpenAI compat uses the same reasoning_effort field (minimal/low/medium/high).
      // Gemini 3 maps effort to thinking_level; Gemini 2.5 maps to thinking_budget.
      return { reasoning_effort: reasoning.effort };

    case 'grok':
      // Grok (xAI) supports reasoning_effort: 'none' | 'low' | 'medium' | 'high'.
      // Map Venus 5-level effort: minimal→none (disable), max→high.
      return {
        reasoning_effort:
          reasoning.effort === 'minimal' ? 'none' : reasoning.effort === 'max' ? 'high' : reasoning.effort,
      };

    case 'dashscope':
      return {
        enable_thinking: true,
        ...(reasoning.budgetTokens ? { thinking_budget: reasoning.budgetTokens } : {}),
      };

    case 'deepseek':
      // DeepSeek native API uses top-level `thinking` parameter (not `extra_body`,
      // which is an OpenAI SDK method-level parameter, not a request body field).
      return {
        reasoning_effort: reasoning.effort,
        thinking: { type: 'enabled' as const },
      };

    case 'kimi':
    case 'mimo':
    case 'zhipu':
      // Kimi (Moonshot) / Xiaomi MIMO / Zhipu (BigModel) use `thinking: { type: "enabled" }`. Budget tokens are not supported.
      return {
        thinking: { type: 'enabled' as const },
      };

    case 'minimax':
      // MiniMax uses `thinking: { type: "adaptive" }` (default) or `{ type: "disabled" }`.
      // When reasoning is requested, we enable adaptive thinking.
      return {
        thinking: { type: 'adaptive' as const },
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

    case 'stepfun':
      // StepFun (阶跃星辰) supports reasoning_effort: low | medium | high.
      // Map Venus 5-level effort to StepFun 3-level: minimal→low, max→high.
      return {
        reasoning_effort: reasoning.effort === 'minimal' ? 'low' : reasoning.effort === 'max' ? 'high' : reasoning.effort,
      };

    case 'qianfan':
      // Baidu Qianfan (ERNIE) uses `enable_thinking: true` (same as DashScope).
      // ERNIE thinking models do NOT support thinking_budget.
      return { enable_thinking: true };

    default:
      return { reasoning_effort: reasoning.effort };
  }
}

/**
 * Translate Venus's reasoning params into Responses API request fields.
 *
 * Unlike `adaptReasoningParams` (Chat Completions field shapes, e.g. top-level
 * `reasoning_effort`), the Responses API nests effort under `reasoning: { effort }`.
 * Currently only Volcano Ark (Doubao) needs endpoint-specific handling; every
 * other endpoint uses the OpenAI Responses shape.
 *
 * The returned object should be merged into the request body via `Object.assign`.
 */
export function adaptResponsesReasoningParams(
  reasoning: ChatReasoningParams | undefined,
  behavior: EndpointBehavior,
): Record<string, unknown> {
  if (behavior === 'volcanoark') {
    // Volcano Ark defaults to thinking ENABLED when `thinking` is omitted, so the
    // toggle is always sent explicitly. Ark effort levels: minimal/low/medium/high/max
    // (minimal disables thinking); `reasoning.summary` is not supported in requests.
    if (!reasoning || reasoning.effort === 'none' || reasoning.effort === 'minimal') {
      return { thinking: { type: 'disabled' as const } };
    }
    return {
      thinking: { type: 'enabled' as const },
      reasoning: { effort: reasoning.effort === 'xhigh' ? 'max' : reasoning.effort },
    };
  }

  if (!reasoning) return {};

  // OpenAI Responses shape — pass effort directly with optional summary
  const fields: Record<string, unknown> = { effort: reasoning.effort };
  if (reasoning.summary) {
    fields.summary = reasoning.summary;
  }
  return { reasoning: fields };
}

/**
 * Auto-detect endpoint behavior from its baseURL.
 * Matches against the generated `ENDPOINT_HOSTS` table (first match wins);
 * falls back to 'openai' for any unrecognized host.
 *
 * @internal used only inside createOpenAIChatProvider (exported for tests)
 */
export function detectEndpointBehavior(baseURL: string): EndpointBehavior {
  for (const [host, behavior] of ENDPOINT_HOSTS) {
    if (baseURL.includes(host)) return behavior;
  }
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

  // MiniMax: reasoning_details is an array of { text: string } when reasoning_split=true
  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
    const texts = message.reasoning_details
      .filter((d: unknown) => typeof d === 'object' && d !== null && typeof (d as Record<string, unknown>).text === 'string')
      .map((d: Record<string, unknown>) => d.text as string);
    if (texts.length > 0) return texts.join('');
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
 * Extract a reasoning delta from a MiniMax streaming chunk.
 *
 * MiniMax uses `reasoning_details` with cumulative text when `reasoning_split=true`.
 * Each chunk's `reasoning_details[0].text` contains the full cumulative reasoning so far.
 * This function computes the incremental delta by tracking the previous cumulative length.
 *
 * @param delta - The delta object from a streaming chunk
 * @param prevLen - The length of the previously seen cumulative reasoning text
 * @returns A tuple of [delta_text, new_cumulative_length], or null if no reasoning is present
 */
export function extractMiniMaxStreamReasoning(
  delta: Record<string, unknown> | null | undefined,
  prevLen: number,
): { text: string; cumulativeLength: number } | null {
  if (!delta) return null;

  if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) {
    const first = delta.reasoning_details[0];
    if (typeof first === 'object' && first !== null && typeof (first as Record<string, unknown>).text === 'string') {
      const cumulativeText = (first as Record<string, unknown>).text as string;
      if (cumulativeText.length > prevLen) {
        return { text: cumulativeText.slice(prevLen), cumulativeLength: cumulativeText.length };
      }
    }
  }

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
  } else {
    // xAI (Grok) exposes reasoning_tokens under prompt_tokens_details in Responses API
    const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    if (promptDetails && typeof promptDetails.reasoning_tokens === 'number') {
      reasoningTokens = promptDetails.reasoning_tokens;
    }
  }

  if (inputTokens === 0 && outputTokens === 0 && reasoningTokens === undefined) {
    return undefined;
  }

  const result: TokenUsage = { inputTokens, outputTokens };
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  return result;
}
