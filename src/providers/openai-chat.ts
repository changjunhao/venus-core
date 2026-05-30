// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - OpenAI Chat Provider
 *
 * LLM provider using the OpenAI SDK for Chat Completions API.
 * Works with any OpenAI-compatible endpoint (OpenAI, DashScope, DeepSeek, Kimi, OpenRouter, etc.).
 *
 * Endpoint behavior (reasoning parameter format) is auto-detected from `baseURL`
 * at construction time via internal `detectEndpointBehavior`. No `style` parameter
 * is exposed — consumers just pass the endpoint URL and everything is handled
 * internally.
 */

import OpenAI from 'openai';
import type { LLMProvider, ChatParams, ChatResponse, StreamChunk } from '../types.js';
import { ProviderError } from '../utils/errors.js';
import type { ProviderErrorCode } from '../utils/errors.js';
import { createParser } from 'vectorjson';
import { defineProvider } from './factory.js';
import {
  adaptReasoningParams,
  detectEndpointBehavior,
  extractReasoningContent,
  extractStreamReasoning,
  extractTokenUsage,
} from './reasoning.js';

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

    if (stream) body.stream = true;

    // Kimi k2.6/k2.5 fix temperature internally (1.0 for thinking, 0.6 for non-thinking)
    // and will reject any other value. MIMO also uses its own internal temperature.
    // OpenAI/DeepSeek reasoning models also ignore temperature.
    const skipTemperature =
      behavior === 'kimi' || behavior === 'mimo' || (params.reasoning !== undefined && (behavior === 'openai' || behavior === 'deepseek'));
    if (params.temperature !== undefined && !skipTemperature) {
      body.temperature = params.temperature;
    }

    if (params.response_format) body.response_format = params.response_format;

    // Adapt reasoning params into endpoint-specific request fields
    const reasoningFields = adaptReasoningParams(params.reasoning, behavior);
    Object.assign(body, reasoningFields);

    // Kimi/MIMO thinking models default to enabled. When the caller does NOT configure
    // reasoning, we must explicitly disable thinking to get standard (non-reasoning) behavior.
    if ((behavior === 'kimi' || behavior === 'mimo') && params.reasoning === undefined) {
      body.thinking = { type: 'disabled' };
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
        if (error instanceof ProviderError) throw error;

        const message = error instanceof Error ? error.message : String(error);
        const oaiError = error as { status?: number; code?: string; cause?: Error & { code?: string } };

        // Also inspect the cause chain (OpenAI SDK wraps fetch errors in APIConnectionError)
        const cause = oaiError.cause;
        const causeCode = cause?.code;
        const causeMessage = cause?.message ?? '';

        let errorCode: ProviderErrorCode = 'unknown';
        if (oaiError.status === 401 || oaiError.status === 403) {
          errorCode = 'auth_error';
        } else if (
          oaiError.code === 'ETIMEDOUT' ||
          oaiError.code === 'ESOCKETTIMEDOUT' ||
          causeCode === 'ETIMEDOUT' ||
          causeCode === 'ESOCKETTIMEDOUT' ||
          message.includes('timeout') ||
          message.includes('timed out') ||
          causeMessage.includes('timeout') ||
          causeMessage.includes('timed out')
        ) {
          errorCode = 'timeout';
        } else if (
          oaiError.code === 'ECONNREFUSED' ||
          oaiError.code === 'ENOTFOUND' ||
          causeCode === 'ECONNREFUSED' ||
          causeCode === 'ENOTFOUND' ||
          message.includes('fetch failed') ||
          causeMessage.includes('fetch failed') ||
          message.includes('Connection error')
        ) {
          errorCode = 'network';
        } else if (oaiError.status && oaiError.status >= 400) {
          errorCode = 'api_error';
        }

        throw new ProviderError(`LLM call failed: ${message}`, provider.name, errorCode, oaiError.status);
      }
    },

    async *chatStream(params: ChatParams): AsyncIterable<StreamChunk> {
      try {
        const requestBody = buildRequestBody(params, true);

        const completion = await client.chat.completions.create(
          requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
        );

        const parser = createParser();

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          const message = delta as unknown as Record<string, unknown>;

          // Yield reasoning chunks
          const reasoningDelta = extractStreamReasoning(message);
          if (reasoningDelta !== null) {
            yield { reasoning: reasoningDelta };
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
