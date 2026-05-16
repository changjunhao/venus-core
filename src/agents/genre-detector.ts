// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type { AgentCallResult, AgentConfig, LLMProvider, StreamChunk } from '../types.js';
import { BaseAgent } from './base-agent.js';
import { GenreEnum } from '../schema/index.js';
import { getGenreDetectorSystemPrompt, getGenreDetectorUserPrompt } from '../prompts/genre-detector.js';
import { z } from 'zod';

/** 门类检测结果 Schema */
const GenreDetectionSchema = z.object({
  genre: GenreEnum,
  confidence: z.number().min(0).max(1),
});

/** 门类检测结果类型（模块内部使用） */
type GenreDetectionResult = z.infer<typeof GenreDetectionSchema>;

export class GenreDetectorAgent extends BaseAgent {
  constructor(provider: LLMProvider, config: AgentConfig) {
    super('门类检测器', provider, config);
  }

  /**
   * 检测照片所属门类（非流式）
   * @returns AgentCallResult 包含检测结果和可选思维链
   */
  async detect(imageUrl: string): Promise<AgentCallResult<GenreDetectionResult>> {
    return await this.call<GenreDetectionResult>(
      getGenreDetectorSystemPrompt(),
      getGenreDetectorUserPrompt(),
      imageUrl,
      GenreDetectionSchema,
    );
  }

  /**
   * 检测照片所属门类（流式）
   * @returns AsyncGenerator yielding StreamChunk，最终返回 AgentCallResult
   */
  detectStream(imageUrl: string): AsyncGenerator<StreamChunk, AgentCallResult<GenreDetectionResult>, unknown> {
    return this.callStream<GenreDetectionResult>(
      getGenreDetectorSystemPrompt(),
      getGenreDetectorUserPrompt(),
      imageUrl,
      GenreDetectionSchema,
    );
  }
}
