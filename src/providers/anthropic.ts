// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Anthropic Provider
 *
 * LLM provider using the `@anthropic-ai/sdk` for Anthropic's Messages API
 * (`client.messages.create`).
 *
 * Highlights:
 * - The first system/developer message is lifted into the top-level `system`
 *   parameter (the Messages API has no `system` role); later turns map to
 *   `user`/`assistant`.
 * - Public image URLs are passed directly as `{ type: 'image', source: { type: 'url' } }`
 *   blocks (no client-side download); `data:` URLs become inline base64 image blocks.
 * - Reasoning effort maps to extended thinking (`thinking: { type: 'enabled', budget_tokens }`),
 *   with thinking blocks surfaced as Venus `reasoning` content and `thinking_tokens`
 *   reported as `usage.reasoningTokens`.
 * - Structured output via `output_config.format` with a strict JSON schema.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  StreamChunk,
  ChatMessage,
  ReasoningEffort,
  ChatReasoningParams,
  TokenUsage,
} from '../types.js';
import { ProviderError } from '../utils/errors.js';
import type { ProviderErrorCode } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { createParser } from 'vectorjson';
import { defineProvider } from './factory.js';
import { getDefaultBudget } from './reasoning.js';

const logger = createLogger('provider:anthropic');

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MAX_TOKENS = 4096;
/** Minimum thinking budget accepted by the Messages API */
const MIN_THINKING_BUDGET = 1024;
/** Tokens reserved for the visible answer on top of the thinking budget */
const THINKING_ANSWER_RESERVE = 4096;

/** Options for creating an Anthropic provider */
export interface AnthropicProviderOptions {
  /** Anthropic API key */
  apiKey: string;
  /** Default model identifier (fallback when params.model is omitted) */
  defaultModel?: string;
  /** API base URL override (default: https://api.anthropic.com) */
  baseURL?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Extra headers to include in requests */
  headers?: Record<string, string>;
  /** Default vendor-specific extra parameters merged into every request (per-call extra takes priority) */
  defaultExtra?: Record<string, unknown>;
  /** Default `max_tokens` when the caller does not supply one via `extra.max_tokens` (default: 4096) */
  defaultMaxTokens?: number;
}

/** Flatten a ChatMessage's content into plain text (for the system prompt) */
function flattenText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** Convert an image_url string into an Anthropic image content block */
function toImageBlock(url: string): Record<string, unknown> {
  // data: URLs carry the image inline — decode into a base64 image source
  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (dataUrlMatch) {
    return { type: 'image', source: { type: 'base64', media_type: dataUrlMatch[1], data: dataUrlMatch[2] } };
  }
  // Public http(s) URLs are passed through directly as a url image source
  return { type: 'image', source: { type: 'url', url } };
}

/** Convert ChatMessage content into Anthropic content blocks */
function convertContentBlocks(content: ChatMessage['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      blocks.push(toImageBlock(part.image_url.url));
    }
  }
  return blocks;
}

/**
 * Convert ChatMessage[] into Messages API input.
 * Extracts the first system/developer message as the top-level `system` prompt;
 * remaining turns map to `user`/`assistant`. Content stays a plain string when it
 * carries no images, otherwise it becomes an array of content blocks.
 */
export function convertAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }>;
} {
  let system: string | undefined;
  const converted: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = [];

  for (const msg of messages) {
    if ((msg.role === 'system' || msg.role === 'developer') && system === undefined) {
      system = flattenText(msg.content);
      continue;
    }
    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof msg.content === 'string' ? msg.content : convertContentBlocks(msg.content);
    converted.push({ role, content });
  }

  return { system, messages: converted };
}

/**
 * Map Venus reasoning params into an Anthropic extended-thinking config.
 * Returns the `thinking` config (when enabled) plus the resolved token budget.
 * Reasoning is disabled (thinking omitted) when not configured or effort is 'none'.
 */
export function mapThinking(reasoning: ChatReasoningParams | undefined): {
  thinking?: { type: 'enabled'; budget_tokens: number };
  budget: number;
} {
  if (!reasoning || reasoning.effort === 'none') {
    return { budget: 0 };
  }
  const requested = reasoning.budgetTokens ?? getDefaultBudget(reasoning.effort as ReasoningEffort);
  const budget = Math.max(MIN_THINKING_BUDGET, requested);
  return { thinking: { type: 'enabled', budget_tokens: budget }, budget };
}

/** Resolve the required `max_tokens`, ensuring it exceeds the thinking budget */
function resolveMaxTokens(params: ChatParams, budget: number, defaultMaxTokens: number): number {
  const fromExtra = params.extra?.max_tokens;
  const base = typeof fromExtra === 'number' ? fromExtra : defaultMaxTokens;
  if (budget > 0) {
    return Math.max(base, budget + THINKING_ANSWER_RESERVE);
  }
  return base;
}

/** Extract concatenated text from Anthropic response content blocks */
export function extractAnthropicText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('');
}

/** Extract concatenated thinking text from Anthropic response content blocks */
export function extractAnthropicReasoning(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'thinking') {
      const thinking = (block as Record<string, unknown>).thinking;
      if (typeof thinking === 'string' && thinking.length > 0) parts.push(thinking);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}

/** Extract Venus TokenUsage from an Anthropic usage object */
export function extractAnthropicUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;

  const inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
  const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : 0;

  let reasoningTokens: number | undefined;
  const details = u.output_tokens_details as Record<string, unknown> | null | undefined;
  if (details && typeof details.thinking_tokens === 'number' && details.thinking_tokens > 0) {
    reasoningTokens = details.thinking_tokens;
  }

  if (inputTokens === 0 && outputTokens === 0 && reasoningTokens === undefined) {
    return undefined;
  }

  const result: TokenUsage = { inputTokens, outputTokens };
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  return result;
}

/** Classify an `@anthropic-ai/sdk` error into a ProviderError with a fine-grained error code */
function classifyAnthropicError(error: unknown, providerName: string): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const apiError = error as { status?: number; code?: string; cause?: Error & { code?: string } };

  const cause = apiError.cause;
  const causeCode = cause?.code;
  const causeMessage = cause?.message ?? '';

  let errorCode: ProviderErrorCode = 'unknown';
  if (apiError.status === 401 || apiError.status === 403) {
    errorCode = 'auth_error';
  } else if (
    apiError.code === 'ETIMEDOUT' ||
    apiError.code === 'ESOCKETTIMEDOUT' ||
    causeCode === 'ETIMEDOUT' ||
    causeCode === 'ESOCKETTIMEDOUT' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    causeMessage.includes('timeout') ||
    causeMessage.includes('timed out')
  ) {
    errorCode = 'timeout';
  } else if (
    apiError.code === 'ECONNREFUSED' ||
    apiError.code === 'ENOTFOUND' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ENOTFOUND' ||
    message.includes('fetch failed') ||
    causeMessage.includes('fetch failed') ||
    message.includes('Connection error')
  ) {
    errorCode = 'network';
  } else if (apiError.status && apiError.status >= 400) {
    errorCode = 'api_error';
  }

  return new ProviderError(`LLM call failed: ${message}`, providerName, errorCode, apiError.status);
}

/**
 * Create an Anthropic Messages API provider backed by the `@anthropic-ai/sdk`.
 *
 * Supports extended thinking (with a tunable token budget), vision inputs,
 * streaming, and strict `json_schema` structured output.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    timeout: options.timeout ?? 60_000,
    defaultHeaders: options.headers,
    // Retries are handled by the Venus engine/agent layer for consistent behavior.
    maxRetries: 0,
  });

  const defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

  /** Build the common messages.create request body for chat / chatStream */
  function buildRequestBody(params: ChatParams, stream?: boolean): Record<string, unknown> {
    const { system, messages } = convertAnthropicMessages(params.messages);
    const { thinking, budget } = mapThinking(params.reasoning);
    const maxTokens = resolveMaxTokens(params, budget, defaultMaxTokens);

    const body: Record<string, unknown> = {
      model: params.model || options.defaultModel,
      max_tokens: maxTokens,
      messages,
    };

    if (system) {
      body.system = system;
    }

    // Extended thinking requires temperature to be 1 (or unset); only forward
    // temperature when thinking is disabled.
    if (thinking) {
      body.thinking = thinking;
    } else if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    // Structured output via output_config.format (strict JSON schema, server-enforced).
    // The Messages API only supports a `json_schema` format; json_object degrades to
    // prompt-driven JSON (no format sent).
    if (params.response_format) {
      if (params.response_format.type === 'json_schema') {
        body.output_config = { format: { type: 'json_schema', schema: params.response_format.schema } };
      } else {
        logger.debug('response_format json_object 无对应 Messages API format，已降级为提示词驱动 JSON');
      }
    }

    if (stream) {
      body.stream = true;
    }

    // Merge defaultExtra and per-call extra (per-call takes priority).
    // `max_tokens` in extra was already consumed by resolveMaxTokens above.
    const mergedExtra = { ...options.defaultExtra, ...params.extra };
    delete (mergedExtra as Record<string, unknown>).max_tokens;
    if (Object.keys(mergedExtra).length > 0) {
      Object.assign(body, mergedExtra);
    }

    return body;
  }

  /** Feed a text delta to the incremental JSON parser and build the stream chunk */
  function makeContentChunk(parser: ReturnType<typeof createParser>, text: string): StreamChunk {
    parser.feed(text);
    try {
      const partial = parser.getValue();
      if (partial !== undefined) {
        return { content: text, partial: partial as Record<string, unknown> };
      }
      return { content: text };
    } catch {
      return { content: text };
    }
  }

  const provider = defineProvider({
    name: `anthropic(${options.baseURL ?? DEFAULT_ANTHROPIC_BASE_URL})`,
    capabilities: {
      vision: true,
      reasoning: true,
      // Extended thinking exposes a tunable token budget.
      reasoningBudget: true,
      streaming: true,
      // Strict JSON schema enforced server-side via output_config.format.
      structuredOutput: 'json_schema',
    },

    async chat(params: ChatParams): Promise<ChatResponse> {
      try {
        const requestBody = buildRequestBody(params);

        const message = await client.messages.create(
          requestBody as unknown as Anthropic.MessageCreateParamsNonStreaming,
        );

        const raw = message as unknown as Record<string, unknown>;
        const content = extractAnthropicText(raw.content);
        if (!content) {
          // No text block in the response — fail with a precise api_error instead
          // of a downstream JSON parse_error.
          throw new ProviderError('Empty response from provider', provider.name, 'api_error');
        }

        const reasoning = extractAnthropicReasoning(raw.content);
        const usage = extractAnthropicUsage(raw.usage);

        const result: ChatResponse = {
          content,
          reasoning,
          raw: message,
        };
        if (usage) result.usage = usage;
        return result;
      } catch (error) {
        throw classifyAnthropicError(error, provider.name);
      }
    },

    async *chatStream(params: ChatParams): AsyncIterable<StreamChunk> {
      // Classify initial request failures (network / timeout / auth) like chat()
      let stream: AsyncIterable<Anthropic.RawMessageStreamEvent>;
      try {
        const requestBody = buildRequestBody(params, true);
        stream = (await client.messages.create(
          requestBody as unknown as Anthropic.MessageCreateParamsStreaming,
        )) as unknown as AsyncIterable<Anthropic.RawMessageStreamEvent>;
      } catch (error) {
        throw classifyAnthropicError(error, provider.name);
      }

      const parser = createParser();
      let inputTokens = 0;
      let outputTokens = 0;
      let reasoningTokens: number | undefined;

      try {
        for await (const event of stream) {
          const evt = event as unknown as Record<string, unknown>;

          switch (evt.type) {
            case 'message_start': {
              const usage = (evt.message as Record<string, unknown> | undefined)?.usage;
              const parsed = extractAnthropicUsage(usage);
              if (parsed) inputTokens = parsed.inputTokens;
              break;
            }
            case 'content_block_delta': {
              const delta = evt.delta as Record<string, unknown> | undefined;
              if (!delta) break;
              if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
                yield makeContentChunk(parser, delta.text);
              } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
                yield { reasoning: delta.thinking };
              }
              // signature_delta / other delta types are intentionally ignored
              break;
            }
            case 'message_delta': {
              const usage = extractAnthropicUsage(evt.usage);
              if (usage) {
                if (usage.outputTokens) outputTokens = usage.outputTokens;
                if (usage.inputTokens) inputTokens = usage.inputTokens;
                if (usage.reasoningTokens !== undefined) reasoningTokens = usage.reasoningTokens;
              }
              break;
            }
            case 'error': {
              const err = evt.error as { message?: string } | undefined;
              throw new ProviderError(
                `Stream call failed: ${err?.message ?? 'Unknown Messages API error'}`,
                provider.name,
                'api_error',
              );
            }
            default:
              break;
          }
        }

        if (inputTokens || outputTokens || reasoningTokens !== undefined) {
          const usage: TokenUsage = { inputTokens, outputTokens };
          if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
          yield { usage };
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`Stream call failed: ${message}`, provider.name, 'api_error');
      } finally {
        parser.destroy();
      }
    },
  });

  return provider;
}
