// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  LLMProvider,
  AgentConfig,
  CallConfig,
  AgentCallResult,
  ChatContentPart,
  ChatMessage,
  StreamChunk,
} from '../types.js';
import { z, type ZodType } from 'zod';
import { ProviderError, SchemaError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

/**
 * BaseAgent — 所有 Agent 的基类
 *
 * 通过构造函数注入 LLMProvider
 */
export class BaseAgent {
  protected readonly name: string;
  protected readonly provider: LLMProvider;
  protected readonly config: AgentConfig;
  protected readonly logger;

  #maxRetries: number;

  constructor(name: string, provider: LLMProvider, config: AgentConfig) {
    this.name = name;
    this.provider = provider;
    this.config = config;
    this.logger = createLogger(`agent:${name}`);
    this.#maxRetries = config.maxRetries ?? 3;
  }

  /** Build user content parts from prompt + image URL */
  #buildUserContent(userPrompt: string, imageUrl: string): ChatContentPart[] {
    const parts: ChatContentPart[] = [{ type: 'text', text: userPrompt }];
    if (imageUrl) {
      parts.push({ type: 'image_url', image_url: { url: imageUrl } });
    }
    return parts;
  }

  /** Build the full message array for a provider call */
  #buildMessages(systemPrompt: string, userPrompt: string, imageUrl: string, history?: ChatMessage[]): ChatMessage[] {
    const userContent = this.#buildUserContent(userPrompt, imageUrl);
    return [
      { role: 'system' as const, content: systemPrompt },
      ...(history ?? []),
      { role: 'user' as const, content: userContent },
    ];
  }

  /** Format reasoning settings for log output */
  #formatReasoningLog(reasoning: AgentConfig['reasoning']): string {
    if (!reasoning) return 'standard';
    return `effort=${reasoning.effort}${reasoning.budgetTokens ? `, budget=${reasoning.budgetTokens}` : ''}`;
  }

  /** Parse JSON content and validate with Zod schema */
  #parseResponse<T>(rawContent: string, schema: ZodType, reasoning: string | null, label?: string): AgentCallResult<T> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      throw new ProviderError(`JSON parse failed: ${(e as Error).message}`, this.provider.name, 'parse_error');
    }
    // Runtime validation by Zod; as T is safe because schema.parse() validates the shape
    const result = schema.parse(parsed) as T;
    this.logger.info(label ? `${label}验证通过` : '验证通过');
    return { result, reasoning };
  }

  /**
   * Append error feedback messages to the conversation history so the
   * model can self-correct on the next retry attempt.
   */
  #pushErrorHistory(history: ChatMessage[], userPrompt: string, imageUrl: string, errorMessage: string): void {
    history.push({
      role: 'user' as const,
      content: this.#buildUserContent(userPrompt, imageUrl),
    });
    history.push({
      role: 'assistant' as const,
      content: errorMessage.includes('JSON') ? '{"error": "format error"}' : '{}',
    });
    history.push({
      role: 'user' as const,
      content: `你的上次输出格式有误: ${errorMessage}。请严格按照要求的 JSON 格式重新输出，不要包含任何多余文字。`,
    });
  }

  /**
   * 核心调用方法：发送图片+文本给 VLM，获取 JSON 响应
   *
   * @param systemPrompt - 系统提示词
   * @param userPrompt - 用户提示词
   * @param imageUrl - 图片的 URL
   * @param schema - Zod schema 用于验证输出
   * @param callConfig - 可选的 per-call 配置覆盖
   */
  async call<T = unknown>(
    systemPrompt: string,
    userPrompt: string,
    imageUrl: string,
    schema: ZodType,
    callConfig?: CallConfig,
  ): Promise<AgentCallResult<T>> {
    let lastError: Error | null = null;
    let reasoning: string | null = null;
    const history: ChatMessage[] = [];
    const reasoningParams = callConfig?.reasoning ?? this.config.reasoning;

    for (let attempt = 0; attempt < this.#maxRetries; attempt++) {
      try {
        const requestMessages = this.#buildMessages(systemPrompt, userPrompt, imageUrl, history);

        this.logger.info(`第 ${attempt + 1} 次调用...`);
        this.logger.debug(
          `Calling provider: role=${this.name}, model=${callConfig?.model ?? this.config.model}, reasoning=${this.#formatReasoningLog(reasoningParams)}, attempt=${attempt + 1}/${this.#maxRetries}`,
        );

        const response = await this.provider.chat({
          model: callConfig?.model ?? this.config.model,
          messages: requestMessages,
          temperature: this.config.temperature ?? 0.3,
          response_format: { type: 'json_object' },
          reasoning: reasoningParams,
        });

        reasoning = response.reasoning ?? null;
        return this.#parseResponse<T>(response.content, schema, reasoning);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`第 ${attempt + 1} 次尝试失败: ${lastError.message}${reasoning ? ' (有推理链)' : ''}`);

        // 如果不是最后一次尝试，将错误信息加入对话历史让模型自我修正
        if (attempt < this.#maxRetries - 1) {
          this.#pushErrorHistory(history, userPrompt, imageUrl, lastError.message);
        }
      }
    }

    throw new SchemaError(`[${this.name}] 在 ${this.#maxRetries} 次尝试后仍然失败: ${lastError?.message}`);
  }

  /**
   * 流式调用方法：使用 provider.chatStream 逐 chunk 产出，最终返回解析结果。
   * 与 call() 共享相同的消息构建逻辑，但不含重试（流式重试由调用方决定）。
   *
   * @returns AsyncGenerator yielding StreamChunk, returning AgentCallResult<T>
   */
  async *callStream<T = unknown>(
    systemPrompt: string,
    userPrompt: string,
    imageUrl: string,
    schema: ZodType,
    callConfig?: CallConfig,
  ): AsyncGenerator<StreamChunk, AgentCallResult<T>, unknown> {
    // 降级：provider 不支持流式，回退到非流式 call()
    if (!this.provider.chatStream) {
      return (await this.call<T>(systemPrompt, userPrompt, imageUrl, schema, callConfig)) as AgentCallResult<T>;
    }

    const reasoningParams = callConfig?.reasoning ?? this.config.reasoning;
    let lastError: Error | null = null;
    const history: ChatMessage[] = [];

    for (let attempt = 0; attempt < this.#maxRetries; attempt++) {
      const requestMessages = this.#buildMessages(
        systemPrompt,
        userPrompt,
        imageUrl,
        attempt > 0 ? history : undefined,
      );

      this.logger.info(`流式第 ${attempt + 1} 次调用...`);
      this.logger.debug(
        `Calling provider (stream): role=${this.name}, model=${callConfig?.model ?? this.config.model}, reasoning=${this.#formatReasoningLog(reasoningParams)}, attempt=${attempt + 1}/${this.#maxRetries}`,
      );

      let reasoning = '';
      let finalContent = '';

      for await (const chunk of this.provider.chatStream({
        model: callConfig?.model ?? this.config.model,
        messages: requestMessages,
        temperature: this.config.temperature ?? 0.3,
        response_format: { type: 'json_object' },
        reasoning: reasoningParams,
      })) {
        if (chunk.reasoning) reasoning += chunk.reasoning;
        if (chunk.content) finalContent += chunk.content;
        yield chunk;
      }

      try {
        return this.#parseResponse<T>(finalContent, schema, reasoning || null, '流式');
      } catch (err: unknown) {
        lastError = err as Error;
        this.logger.warn(
          `流式第 ${attempt + 1} 次验证失败: ${err instanceof z.ZodError ? err.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ') : String(err)}`,
        );

        // 将错误信息加入对话历史，让模型在下一次流式尝试中自我修正（与 call() 重试模式一致）
        if (attempt < this.#maxRetries - 1) {
          this.#pushErrorHistory(history, userPrompt, imageUrl, lastError.message);
        }
      }
    }

    throw new SchemaError(`[${this.name}] 在 ${this.#maxRetries} 次流式尝试后仍然失败: ${lastError?.message}`);
  }
}
