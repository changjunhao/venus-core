// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Gemini Provider
 *
 * Uses the `@google/genai` SDK's Interactions API (`client.interactions.create`)
 * for Google's Gemini models.
 *
 * Highlights:
 * - Public image URLs are passed directly as `{ type: 'image', uri }` blocks
 *   (no client-side download / base64 round-trip); `data:` URLs are converted
 *   to inline base64 image blocks.
 * - Structured output via `response_format` with a JSON schema (strict).
 * - Thinking is controlled through `generation_config.thinking_level`, with
 *   thought summaries surfaced as Venus `reasoning` content.
 */

import { GoogleGenAI, type Interactions } from '@google/genai';
import type { LLMProvider, ChatParams, ChatResponse, StreamChunk, ChatMessage, ReasoningEffort, TokenUsage } from '../types.js';
import { ProviderError } from '../utils/errors.js';
import type { ProviderErrorCode } from '../utils/errors.js';
import { createParser } from 'vectorjson';
import { defineProvider } from './factory.js';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Options for creating a Gemini provider */
export interface GeminiProviderOptions {
  /** Gemini API key */
  apiKey: string;
  /** Default model identifier (fallback when params.model is omitted) */
  defaultModel?: string;
  /** API base URL override (default: https://generativelanguage.googleapis.com) */
  baseURL?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Extra headers to include in requests */
  headers?: Record<string, string>;
  /** Default vendor-specific extra parameters merged into every request (per-call extra takes priority) */
  defaultExtra?: Record<string, unknown>;
}

/** Map Venus reasoning effort to Interactions API thinking_level */
function mapThinkingLevel(effort: ReasoningEffort): string {
  switch (effort) {
    case 'none':
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    default:
      // high / max / xhigh
      return 'high';
  }
}

/** Convert an image_url string into an Interactions image content block */
function toImageContent(url: string): Record<string, unknown> {
  // data: URLs carry the image inline — decode into a base64 image block
  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (dataUrlMatch) {
    return { type: 'image', data: dataUrlMatch[2], mime_type: dataUrlMatch[1] };
  }
  // Public http(s) URLs (and Files API URIs) are passed through directly
  return { type: 'image', uri: url };
}

/** Flatten a ChatMessage's content into plain text (for system instructions) */
function flattenText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** Convert ChatMessage content into Interactions content blocks */
function convertContentBlocks(content: ChatMessage['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      blocks.push(toImageContent(part.image_url.url));
    }
  }
  return blocks;
}

/**
 * Convert ChatMessage[] into Interactions API input turns.
 * Extracts the first system/developer message as `system_instruction`;
 * any later system messages are folded into user turns.
 */
export function convertGeminiMessages(messages: ChatMessage[]): {
  systemInstruction: string | undefined;
  turns: Array<{ role: 'user' | 'model'; content: Array<Record<string, unknown>> }>;
} {
  let systemInstruction: string | undefined;
  const turns: Array<{ role: 'user' | 'model'; content: Array<Record<string, unknown>> }> = [];

  for (const msg of messages) {
    if ((msg.role === 'system' || msg.role === 'developer') && systemInstruction === undefined) {
      systemInstruction = flattenText(msg.content);
      continue;
    }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    turns.push({ role, content: convertContentBlocks(msg.content) });
  }

  return { systemInstruction, turns };
}

/** Extract Venus TokenUsage from an Interactions usage object */
export function extractGeminiUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;

  const inputTokens = typeof u.total_input_tokens === 'number' ? u.total_input_tokens : 0;
  const outputTokens = typeof u.total_output_tokens === 'number' ? u.total_output_tokens : 0;
  const reasoningTokens = typeof u.total_thought_tokens === 'number' ? u.total_thought_tokens : undefined;

  if (inputTokens === 0 && outputTokens === 0 && reasoningTokens === undefined) {
    return undefined;
  }

  const result: TokenUsage = { inputTokens, outputTokens };
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  return result;
}

/** Extract concatenated thought-summary text from interaction steps */
export function extractGeminiReasoning(steps: unknown): string | null {
  if (!Array.isArray(steps)) return null;

  const parts: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as Record<string, unknown>;
    if (s.type !== 'thought') continue;

    // Thought steps may carry only a signature with an empty/absent summary
    if (Array.isArray(s.summary)) {
      for (const item of s.summary) {
        if (item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text') {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === 'string' && text.length > 0) parts.push(text);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/** Extract concatenated model_output text from interaction steps (fallback when output_text is absent) */
function extractModelOutputText(steps: unknown): string {
  if (!Array.isArray(steps)) return '';

  const parts: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as Record<string, unknown>;
    if (s.type !== 'model_output' || !Array.isArray(s.content)) continue;
    for (const block of s.content) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
  }

  return parts.join('');
}

/** Classify a `@google/genai` SDK error into a ProviderError with a fine-grained error code */
function classifyGeminiError(error: unknown, providerName: string): ProviderError {
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
 * Create a Google Gemini provider backed by the `@google/genai` Interactions API.
 *
 * Requires Gemini 2.5+ / 3.x series models (older models are not supported by
 * the Interactions API). Public image URLs are passed to the API directly.
 */
export function createGeminiProvider(options: GeminiProviderOptions): LLMProvider {
  const httpOptions: Record<string, unknown> = { timeout: options.timeout ?? 60_000 };
  if (options.baseURL) httpOptions.baseUrl = options.baseURL;
  if (options.headers) httpOptions.headers = options.headers;

  const client = new GoogleGenAI({ apiKey: options.apiKey, httpOptions });

  /** Build the common interactions.create request body for chat / chatStream */
  function buildRequestBody(params: ChatParams): Record<string, unknown> {
    const { systemInstruction, turns } = convertGeminiMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model || options.defaultModel,
      input: turns,
      // Stateless call — Venus manages conversation history itself
      store: false,
    };

    if (systemInstruction) {
      body.system_instruction = systemInstruction;
    }

    // Structured output via response_format (JSON schema is enforced by the API)
    if (params.response_format) {
      if (params.response_format.type === 'json_schema') {
        body.response_format = {
          type: 'text',
          mime_type: 'application/json',
          schema: params.response_format.schema,
        };
      } else {
        body.response_format = { type: 'text', mime_type: 'application/json' };
      }
    }

    // Thinking + sampling configuration.
    // When reasoning is not configured, thinking_level is omitted (Gemini models
    // default to dynamic thinking — same convention as the OpenAI-compat path).
    // budgetTokens is not supported by the Interactions API and is silently ignored.
    const generationConfig: Record<string, unknown> = {};
    if (params.temperature !== undefined) {
      generationConfig.temperature = params.temperature;
    }
    if (params.reasoning) {
      generationConfig.thinking_level = mapThinkingLevel(params.reasoning.effort);
      generationConfig.thinking_summaries = 'auto';
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generation_config = generationConfig;
    }

    // Merge defaultExtra and per-call extra (per-call takes priority)
    const mergedExtra = { ...options.defaultExtra, ...params.extra };
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
    name: `gemini(${options.baseURL ?? DEFAULT_GEMINI_BASE_URL})`,
    capabilities: {
      vision: true,
      reasoning: true,
      // Interactions API controls thinking via thinking_level only (no token budget)
      reasoningBudget: false,
      streaming: true,
      structuredOutput: 'json_schema',
    },

    async chat(params: ChatParams): Promise<ChatResponse> {
      try {
        const requestBody = buildRequestBody(params);

        const interaction = await client.interactions.create(
          requestBody as unknown as Interactions.CreateModelInteractionParamsNonStreaming,
        );

        const raw = interaction as unknown as Record<string, unknown>;

        // Prefer the SDK's output_text convenience field; fall back to model_output steps
        let content = typeof raw.output_text === 'string' ? raw.output_text : '';
        if (!content) {
          content = extractModelOutputText(raw.steps);
        }
        if (!content) {
          // Neither output_text nor any model_output step carried text — fail here
          // with a precise api_error instead of a downstream JSON parse_error.
          throw new ProviderError('Empty response from provider', provider.name, 'api_error');
        }

        const reasoning = extractGeminiReasoning(raw.steps);
        const usage = extractGeminiUsage(raw.usage);

        const result: ChatResponse = {
          content,
          reasoning,
          raw: interaction,
        };
        if (usage) result.usage = usage;
        return result;
      } catch (error) {
        throw classifyGeminiError(error, provider.name);
      }
    },

    async *chatStream(params: ChatParams): AsyncIterable<StreamChunk> {
      // Classify initial request failures (network / timeout / auth) like chat()
      let stream: AsyncIterable<Interactions.InteractionSSEEvent>;
      try {
        const requestBody = buildRequestBody(params);
        stream = (await client.interactions.create({
          ...requestBody,
          stream: true,
        } as unknown as Interactions.CreateModelInteractionParamsStreaming)) as unknown as AsyncIterable<Interactions.InteractionSSEEvent>;
      } catch (error) {
        throw classifyGeminiError(error, provider.name);
      }

      const parser = createParser();

      try {
        for await (const event of stream) {
          const evt = event as unknown as Record<string, unknown>;
          const eventType = evt.event_type as string;

          if (eventType === 'error') {
            const err = evt.error as { code?: string; message?: string } | undefined;
            const message = err?.message ?? 'Unknown Interactions API error';
            throw new ProviderError(`Stream call failed: ${message}`, provider.name, 'api_error');
          }

          if (eventType === 'step.start') {
            // The first content block may arrive embedded in step.start
            const step = evt.step as Record<string, unknown> | undefined;
            if (!step) continue;

            if (step.type === 'thought') {
              const reasoning = extractGeminiReasoning([step]);
              if (reasoning) {
                yield { reasoning };
              }
            } else if (step.type === 'model_output') {
              const text = extractModelOutputText([step]);
              if (text) {
                yield makeContentChunk(parser, text);
              }
            }
          } else if (eventType === 'step.delta') {
            const delta = evt.delta as Record<string, unknown> | undefined;
            if (!delta) continue;

            if (delta.type === 'text' && typeof delta.text === 'string' && delta.text) {
              yield makeContentChunk(parser, delta.text);
            } else if (delta.type === 'thought_summary') {
              // Thought summary deltas carry a single content block
              const contentBlock = delta.content as Record<string, unknown> | undefined;
              if (contentBlock?.type === 'text' && typeof contentBlock.text === 'string' && contentBlock.text) {
                yield { reasoning: contentBlock.text };
              }
            }
            // thought_signature and other delta types are intentionally ignored
          } else if (eventType === 'interaction.completed') {
            // Terminal event — extract token usage from the final interaction
            const finalInteraction = evt.interaction as Record<string, unknown> | undefined;
            const usage = extractGeminiUsage(finalInteraction?.usage);
            if (usage) {
              yield { usage };
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
