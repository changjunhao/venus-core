// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - OpenAI Chat Provider
 *
 * LLM provider using the OpenAI SDK for Chat Completions API.
 * Works with any OpenAI-compatible endpoint (OpenAI, DashScope, DeepSeek, Gemini, Grok, Kimi, OpenRouter, Qianfan, StepFun, etc.).
 *
 * Endpoint behavior (reasoning parameter format) is auto-detected from `baseURL`
 * at construction time via internal `detectEndpointBehavior`. No `style` parameter
 * is exposed — consumers just pass the endpoint URL and everything is handled
 * internally.
 */

import OpenAI from 'openai';
import type { LLMProvider, ChatParams, ChatResponse, StreamChunk } from '../types.js';
import { ProviderError } from '../utils/errors.js';
import { classifyOpenAIError } from './openai-errors.js';
import { createLogger } from '../utils/logger.js';
import { createParser } from 'vectorjson';
import { defineProvider } from './factory.js';
import {
  adaptReasoningParams,
  detectEndpointBehavior,
  extractReasoningContent,
  extractStreamReasoning,
  extractMiniMaxStreamReasoning,
  extractTokenUsage,
} from './reasoning.js';

const logger = createLogger('provider:openai-chat');

/** Options for creating an OpenAI Chat provider */
export interface OpenAIChatProviderOptions {
  /** OpenAI-compatible API base URL */
  baseURL: string;
  /** API key */
  apiKey: string;
  /** Default model identifier (fallback when params.model is omitted) */
  defaultModel?: string;
  /** Extra headers to include in requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Default vendor-specific extra parameters merged into every request (per-call extra takes priority) */
  defaultExtra?: Record<string, unknown>;
  /**
   * Whether to request token usage in streaming mode via `stream_options.include_usage`.
   * Set to `false` for endpoints that do not support this parameter.
   * @default true
   */
  includeUsage?: boolean;
}

export function createOpenAIChatProvider(options: OpenAIChatProviderOptions): LLMProvider {
  const client = new OpenAI({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    timeout: options.timeout ?? 60_000,
    defaultHeaders: options.headers,
  });

  // Auto-detect endpoint behavior from baseURL (internal — not exposed to consumers)
  const behavior = detectEndpointBehavior(options.baseURL);

  /** Build common request body for chat / chatStream */
  function buildRequestBody(params: ChatParams, stream?: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model || options.defaultModel,
      messages: params.messages,
    };

    if (stream) {
      body.stream = true;
      // Request token usage in the final streaming chunk (OpenAI Chat Completions API).
      // Can be disabled via `includeUsage: false` for endpoints that do not support it.
      if (options.includeUsage !== false) {
        body.stream_options = { include_usage: true };
      }
    }

    // Kimi k2.6/k2.5 fix temperature internally (1.0 for thinking, 0.6 for non-thinking)
    // and will reject any other value. MIMO also uses its own internal temperature.
    // OpenAI/DeepSeek reasoning models also ignore temperature.
    const skipTemperature =
      behavior === 'kimi' ||
      behavior === 'mimo' ||
      (params.reasoning !== undefined && (behavior === 'openai' || behavior === 'deepseek' || behavior === 'gemini'));
    if (params.temperature !== undefined && !skipTemperature) {
      body.temperature = params.temperature;
    }

    // Chat Completions: json_schema degrades to json_object.
    // Schema enforcement is intentionally not applied for now; a future version
    // may pass json_schema through for endpoints verified to support it.
    if (params.response_format) {
      if (params.response_format.type === 'json_schema') {
        logger.warn(`response_format json_schema 未被 Chat Completions provider 强制执行，已降级为 json_object（schema "${params.response_format.name}" 被忽略）`);
      }
      body.response_format = { type: 'json_object' };
    }

    // Adapt reasoning params into endpoint-specific request fields.
    // adaptReasoningParams handles both enable (reasoning configured) and
    // explicit disable (reasoning not configured but model defaults to thinking).
    const reasoningFields = adaptReasoningParams(params.reasoning, behavior);
    Object.assign(body, reasoningFields);

    // MiniMax: always enable reasoning_split to get clean reasoning_details instead of inline  tags
    if (behavior === 'minimax') {
      body.reasoning_split = true;
    }

    // Merge defaultExtra and per-call extra (per-call takes priority)
    const mergedExtra = { ...options.defaultExtra, ...params.extra };
    if (Object.keys(mergedExtra).length > 0) {
      Object.assign(body, mergedExtra);
    }

    return body;
  }

  const provider = defineProvider({
    name: `openai-chat(${options.baseURL})`,
    capabilities: {
      vision: true,
      reasoning: true,
      reasoningBudget: behavior === 'dashscope' || behavior === 'openrouter',
      streaming: true,
      structuredOutput: 'json_object',
    },

    async chat(params: ChatParams): Promise<ChatResponse> {
      try {
        const requestBody = buildRequestBody(params);

        const response = await client.chat.completions.create(
          requestBody as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
        );

        const choice = response.choices[0];
        if (!choice?.message) {
          throw new ProviderError('Empty response from provider', provider.name, 'api_error');
        }

        const message = choice.message as unknown as Record<string, unknown>;
        const reasoning = extractReasoningContent(message);
        const usage = extractTokenUsage(response);

        const result: ChatResponse = {
          content: (message.content as string) ?? '',
          reasoning,
          raw: response,
        };
        if (usage) result.usage = usage;
        return result;
      } catch (error) {
        throw classifyOpenAIError(error, provider.name);
      }
    },

    async *chatStream(params: ChatParams): AsyncIterable<StreamChunk> {
      try {
        const requestBody = buildRequestBody(params, true);

        const completion = await client.chat.completions.create(
          requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
        );

        const parser = createParser();
        // MiniMax streaming reasoning: track cumulative text length for delta computation
        let miniMaxReasoningLen = 0;

        for await (const chunk of completion) {
          // Extract token usage from the final chunk (enabled by stream_options.include_usage)
          const chunkUsage = extractTokenUsage(chunk);
          if (chunkUsage) {
            yield { usage: chunkUsage };
          }

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          const message = delta as unknown as Record<string, unknown>;

          if (behavior === 'minimax') {
            // MiniMax uses cumulative reasoning_details; compute delta
            const mmReasoning = extractMiniMaxStreamReasoning(message, miniMaxReasoningLen);
            if (mmReasoning !== null) {
              miniMaxReasoningLen = mmReasoning.cumulativeLength;
              yield { reasoning: mmReasoning.text };
            }
          } else {
            const reasoningDelta = extractStreamReasoning(message);
            if (reasoningDelta !== null) {
              yield { reasoning: reasoningDelta };
            }
          }

          // Yield content and incremental JSON partials
          if (typeof message.content === 'string') {
            parser.feed(message.content);
            try {
              const partial = parser.getValue();
              if (partial !== undefined) {
                yield { content: message.content, partial: partial as Record<string, unknown> };
              } else {
                yield { content: message.content };
              }
            } catch {
              yield { content: message.content };
            }
          }
        }

        parser.destroy();
      } catch (error) {
        if (error instanceof ProviderError) throw error;

        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`Stream call failed: ${message}`, provider.name, 'api_error');
      }
    },
  });

  return provider;
}
