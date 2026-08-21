// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - OpenAI Responses Provider
 *
 * Uses OpenAI's `/v1/responses` API with `text.format` json_schema
 * for structured output. Supports reasoning-capable models (o-series).
 *
 * Also works with Responses-compatible endpoints such as Volcano Ark (Doubao),
 * Xiaomi MiMo, and DeepSeek. Endpoint behavior (reasoning parameter shape) is
 * auto-detected from `baseURL` at construction time via internal
 * `detectEndpointBehavior`.
 */

import OpenAI from 'openai';
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  StreamChunk,
  TokenUsage,
  ChatMessage,
  ChatContentPart,
} from '../types.js';
import { ProviderError } from '../utils/errors.js';
import { classifyProviderError } from './provider-errors.js';
import { createLogger } from '../utils/logger.js';
import { createParser } from 'vectorjson';
import { defineProvider } from './factory.js';
import { makeContentChunk } from './stream-utils.js';
import { adaptResponsesReasoningParams, detectEndpointBehavior } from './reasoning.js';

const logger = createLogger('provider:openai-responses');

/** Options for creating an OpenAI Responses provider */
export interface OpenAIResponsesProviderOptions {
  /** OpenAI API base URL */
  baseURL: string;
  /** API key */
  apiKey: string;
  /** Default model identifier (fallback when params.model is omitted) */
  defaultModel?: string;
  /** Extra headers to include in requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
  /**
   * Whether to request token usage in streaming mode.
   * @default true
   */
  includeUsage?: boolean;
  /** Provider-specific default extra parameters */
  defaultExtra?: Record<string, unknown>;
}

/**
 * Extract token usage from a Responses API response object.
 * Responses API uses `input_tokens` / `output_tokens` with
 * `output_tokens_details.reasoning_tokens`.
 */
export function extractResponsesTokenUsage(response: unknown): TokenUsage | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const r = response as Record<string, unknown>;
  const usage = r.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;

  let reasoningTokens: number | undefined;
  const outputDetails = usage.output_tokens_details as Record<string, unknown> | undefined;
  if (outputDetails && typeof outputDetails.reasoning_tokens === 'number') {
    reasoningTokens = outputDetails.reasoning_tokens;
  }

  if (inputTokens === 0 && outputTokens === 0 && reasoningTokens === undefined) {
    return undefined;
  }

  const result: TokenUsage = { inputTokens, outputTokens };
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  return result;
}

/**
 * Extract reasoning text from Responses API output items.
 * Reasoning items have `type: "reasoning"` with a `summary` array
 * (OpenAI; also Volcano Ark digest) and/or a `content` array of
 * `reasoning_text` items (Volcano Ark / Xiaomi MiMo raw chain-of-thought).
 */
export function extractResponsesReasoning(output: unknown[]): string | null {
  if (!Array.isArray(output)) return null;

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (obj.type !== 'reasoning') continue;

    const summary = obj.summary;
    if (Array.isArray(summary)) {
      for (const s of summary) {
        if (s && typeof s === 'object' && typeof (s as Record<string, unknown>).text === 'string') {
          parts.push((s as Record<string, unknown>).text as string);
        }
      }
    }

    // Volcano Ark (Doubao) places the raw chain-of-thought in `content` items of
    // type `reasoning_text` (newer models keep only a digest in `summary`).
    const content = obj.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== 'object') continue;
        const part = c as Record<string, unknown>;
        if (part.type === 'reasoning_text' && typeof part.text === 'string') {
          parts.push(part.text);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Convert Chat Completions content parts into Responses API input format.
 * User/system parts map to `input_text` / `input_image` (with `image_url` as a
 * plain string); assistant parts map to `output_text`.
 */
function convertContentParts(parts: ChatContentPart[], role: string): Array<{ type: string; [key: string]: unknown }> {
  const converted: Array<{ type: string; [key: string]: unknown }> = [];
  for (const part of parts) {
    if (part.type === 'text') {
      converted.push({ type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text });
    } else if (part.type === 'image_url' && role !== 'assistant') {
      converted.push({ type: 'input_image', image_url: part.image_url.url });
    }
  }
  return converted;
}

/**
 * Convert ChatMessage[] into Responses API input format.
 * Extracts the first system message as `instructions`.
 */
function convertMessages(messages: ChatMessage[]): {
  instructions: string | undefined;
  input: Array<{ role: string; content: string | Array<{ type: string; [key: string]: unknown }> }>;
} {
  let instructions: string | undefined;
  const input: Array<{ role: string; content: string | Array<{ type: string; [key: string]: unknown }> }> = [];

  for (const msg of messages) {
    if ((msg.role === 'system' || msg.role === 'developer') && instructions === undefined) {
      // Extract first system/developer message as instructions
      instructions =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
      continue;
    }

    // Map developer role to system for remaining messages
    const role = msg.role === 'developer' ? 'system' : msg.role;
    const content = typeof msg.content === 'string' ? msg.content : convertContentParts(msg.content, role);
    input.push({ role, content });
  }

  return { instructions, input };
}

/**
 * Create an OpenAI Responses API provider.
 *
 * Uses `/v1/responses` with `text.format` json_schema for structured output.
 */
export function createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): LLMProvider {
  const client = new OpenAI({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    timeout: options.timeout ?? 60_000,
    defaultHeaders: options.headers,
  });

  // Auto-detect endpoint behavior from baseURL (internal — not exposed to consumers)
  const behavior = detectEndpointBehavior(options.baseURL);

  // Single source of truth for structured output support:
  // MiMo's text.format only supports json_object (no json_schema enforcement).
  // DeepSeek accepts text.format json_schema but does NOT reliably enforce it in
  // practice (observed on deepseek-v4-flash-vision-exp: responses pass Zod
  // validation upstream yet violate the schema downstream, e.g. at the critic
  // stage), so it also degrades to json_object to keep the engine-side Zod
  // validation + retry loop active.
  const structuredOutput = behavior === 'mimo' || behavior === 'deepseek' ? 'json_object' : 'json_schema';

  /** Build common request body for Responses API */
  function buildRequestBody(params: ChatParams, stream?: boolean): Record<string, unknown> {
    const { instructions, input } = convertMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model || options.defaultModel,
      input,
      store: false,
    };

    if (instructions) {
      body.instructions = instructions;
    }

    if (stream) {
      body.stream = true;
    }

    // Temperature — reasoning models (o-series / GPT-5) reject it on the
    // Responses API, so skip it whenever reasoning is configured. Volcano Ark
    // accepts temperature alongside thinking (models ignore it instead of rejecting).
    // MIMO always uses its own internal temperature (same as the Chat provider).
    const skipTemperature = behavior === 'mimo' || (params.reasoning !== undefined && behavior !== 'volcanoark');
    if (params.temperature !== undefined && !skipTemperature) {
      body.temperature = params.temperature;
    }

    // Structured output via text.format.
    // When the endpoint lacks json_schema support (see `structuredOutput` above),
    // json_schema degrades with a warning (schema enforcement falls back to the
    // engine-side zod validation).
    if (params.response_format) {
      if (params.response_format.type === 'json_schema' && structuredOutput === 'json_schema') {
        const { name, schema, description, strict } = params.response_format;
        const format: Record<string, unknown> = { type: 'json_schema', name, schema, strict: strict ?? true };
        if (description) format.description = description;
        body.text = { format };
      } else {
        if (params.response_format.type === 'json_schema') {
          logger.warn(
            `response_format json_schema 未被该 Responses 端点强制执行（MiMo 仅支持 json_object；DeepSeek 实测未可靠约束输出），已降级为 json_object（schema "${params.response_format.name}" 被忽略）`,
          );
        }
        body.text = { format: { type: 'json_object' } };
      }
    }

    // Reasoning configuration — endpoint-specific Responses API shape
    // (OpenAI: reasoning.effort/summary; Volcano Ark: thinking.type + reasoning.effort;
    // MiMo: reasoning.effort only, 'none' disables thinking)
    Object.assign(body, adaptResponsesReasoningParams(params.reasoning, behavior));

    // Merge defaultExtra and per-call extra (per-call takes priority)
    const mergedExtra = { ...options.defaultExtra, ...params.extra };
    if (mergedExtra && Object.keys(mergedExtra).length > 0) {
      Object.assign(body, mergedExtra);
    }

    return body;
  }

  const provider = defineProvider({
    name: `openai-responses(${options.baseURL})`,
    capabilities: {
      vision: true,
      reasoning: true,
      reasoningBudget: false,
      streaming: true,
      structuredOutput,
    },

    async chat(params: ChatParams): Promise<ChatResponse> {
      try {
        const requestBody = buildRequestBody(params);

        const response = await client.responses.create(
          requestBody as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming,
        );

        const resp = response as unknown as Record<string, unknown>;

        const content = typeof resp.output_text === 'string' ? resp.output_text : '';
        const reasoning = extractResponsesReasoning(resp.output as unknown[]);
        const usage = extractResponsesTokenUsage(response);

        const result: ChatResponse = {
          content,
          reasoning,
          raw: response,
        };
        if (usage) result.usage = usage;
        return result;
      } catch (error) {
        throw classifyProviderError(error, provider.name);
      }
    },

    async *chatStream(params: ChatParams): AsyncIterable<StreamChunk> {
      // Classify initial request failures (network / timeout / auth) like chat()
      let stream: AsyncIterable<unknown>;
      try {
        const requestBody = buildRequestBody(params, true);
        stream = await client.responses.create(
          requestBody as unknown as OpenAI.Responses.ResponseCreateParamsStreaming,
        );
      } catch (error) {
        throw classifyProviderError(error, provider.name);
      }

      const parser = createParser();

      try {
        for await (const event of stream) {
          const evt = event as Record<string, unknown>;
          const eventType = evt.type as string;

          // Error / failure events — throw immediately.
          // Top-level `error` events carry `message` directly; `response.error`
          // carries it under `error`; `response.failed` under `response.error`.
          if (eventType === 'error' || eventType === 'response.error' || eventType === 'response.failed') {
            const failedResponse = evt.response as Record<string, unknown> | undefined;
            const err = (eventType === 'response.failed' ? failedResponse?.error : (evt.error ?? evt)) as
              { message?: string; code?: string; status?: number } | undefined;
            const message = err?.message ?? 'Unknown Responses API error';
            throw new ProviderError(`Stream call failed: ${message}`, provider.name, 'api_error', err?.status);
          }

          // Text content delta
          if (eventType === 'response.output_text.delta') {
            const delta = typeof evt.delta === 'string' ? evt.delta : '';
            if (delta) {
              yield makeContentChunk(parser, delta);
            }
          } else if (eventType === 'response.reasoning_summary_text.delta') {
            // Reasoning summary delta (streamed reasoning)
            const delta = typeof evt.delta === 'string' ? evt.delta : '';
            if (delta) {
              yield { reasoning: delta };
            }
          } else if (eventType === 'response.reasoning_text.delta') {
            // Raw chain-of-thought delta (Xiaomi MiMo; OpenAI gpt-oss variants)
            const delta = typeof evt.delta === 'string' ? evt.delta : '';
            if (delta) {
              yield { reasoning: delta };
            }
          } else if (eventType === 'response.completed' || eventType === 'response.incomplete') {
            // Terminal events — extract usage (only when includeUsage is not explicitly false)
            if (options.includeUsage !== false) {
              const finalResponse = evt.response as Record<string, unknown> | undefined;
              if (finalResponse) {
                const usage = extractResponsesTokenUsage(finalResponse);
                if (usage) {
                  yield { usage };
                }
              }
            }
          }
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
