// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - OpenAI Compatible Provider
 *
 * Default LLM provider implementation using the OpenAI SDK.
 * Works with any OpenAI-compatible API (OpenAI, DashScope, Together, vLLM, etc.)
 */

import OpenAI from 'openai';
import type { LLMProvider, ChatParams, ChatResponse, StreamChunk } from '../types.js';
import type { OpenAICompatOptions } from './types.js';
import { ProviderError } from '../utils/errors.js';
import type { ProviderErrorCode } from '../utils/errors.js';
import { createParser } from 'vectorjson';

export function createOpenAICompatProvider(options: OpenAICompatOptions): LLMProvider {
  const client = new OpenAI({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    timeout: options.timeout ?? 60_000,
    defaultHeaders: options.headers,
  });

  /** Build common request body for chat / chatStream */
  function buildRequestBody(params: ChatParams, stream?: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model || options.defaultModel || 'qwen3-vl-flash',
      messages: params.messages,
    };

    if (stream) body.stream = true;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.response_format) body.response_format = params.response_format;

    // Handle thinking/chain-of-thought — 显式传递 enabled 状态
    if (params.thinking) {
      body.enable_thinking = params.thinking.enabled;
      if (params.thinking.enabled && params.thinking.budget_tokens) {
        body.thinking_budget = params.thinking.budget_tokens;
      }
    }

    // Merge defaultExtra and per-call extra (per-call takes priority)
    const mergedExtra = { ...options.defaultExtra, ...params.extra };
    if (Object.keys(mergedExtra).length > 0) {
      Object.assign(body, mergedExtra);
    }

    return body;
  }

  const provider: LLMProvider = {
    name: `openai-compat(${options.baseURL})`,
    supportsVision: true,
    supportsThinking: true,

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

        // Extract thinking from various possible locations
        const message = choice.message as unknown as Record<string, unknown>;
        let thinking: string | null = null;

        if (typeof message.reasoning_content === 'string') {
          thinking = message.reasoning_content;
        } else if (typeof message.thinking === 'string') {
          thinking = message.thinking;
        }

        return {
          content: (message.content as string) ?? '',
          thinking,
          raw: response,
        };
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

          // Yield thinking/reasoning chunks
          if (typeof message.reasoning_content === 'string') {
            yield { thinking: message.reasoning_content };
          } else if (typeof message.thinking === 'string') {
            yield { thinking: message.thinking };
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
  };

  return provider;
}
