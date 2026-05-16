// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  AgentCallResult,
  AgentConfig,
  CallConfig,
  CritiqueResult,
  EvaluationContext,
  Genre,
  LLMProvider,
  ProposerResult,
  StreamChunk,
} from '../types.js';
import { BaseAgent } from './base-agent.js';
import { getSchemas } from '../schema/index.js';
import { getProposerSystemPrompt, getProposerUserPrompt, getRevisionUserPrompt } from '../prompts/proposer.js';

export class ProposerAgent extends BaseAgent {
  #revisionConfig: CallConfig | undefined;

  constructor(provider: LLMProvider, config: AgentConfig, revisionConfig?: CallConfig) {
    super('提案者(Proposer)', provider, config);
    this.#revisionConfig = revisionConfig;
  }

  /** 组装 evaluate 调用参数 */
  #prepareEvaluate(genre: Genre, context?: EvaluationContext) {
    const { proposalSchema } = getSchemas(genre);
    return {
      schema: proposalSchema,
      systemPrompt: getProposerSystemPrompt(genre),
      userPrompt: getProposerUserPrompt(genre, context),
    };
  }

  /** 组装 revise 调用参数 */
  #prepareRevision(
    genre: Genre,
    originalProposal: ProposerResult,
    critiqueResult: CritiqueResult,
    critiqueThinking: string | null,
    context?: EvaluationContext,
  ) {
    const { proposalSchema } = getSchemas(genre);
    return {
      schema: proposalSchema,
      systemPrompt: getProposerSystemPrompt(genre),
      userPrompt: getRevisionUserPrompt(genre, originalProposal, critiqueResult, critiqueThinking, context),
    };
  }

  /** 初始评估 */
  async evaluate(
    imageUrl: string,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): Promise<AgentCallResult<ProposerResult>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareEvaluate(genre, context);
    return await this.call(systemPrompt, userPrompt, imageUrl, schema);
  }

  /** 在收到批判后修正评估 */
  async revise(
    imageUrl: string,
    originalProposal: ProposerResult,
    critiqueResult: CritiqueResult,
    critiqueThinking: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): Promise<AgentCallResult<ProposerResult>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareRevision(
      genre,
      originalProposal,
      critiqueResult,
      critiqueThinking,
      context,
    );
    return await this.call(systemPrompt, userPrompt, imageUrl, schema, this.#revisionConfig);
  }

  /** 初始评估（流式） */
  evaluateStream(
    imageUrl: string,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<ProposerResult>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareEvaluate(genre, context);
    return this.callStream<ProposerResult>(systemPrompt, userPrompt, imageUrl, schema);
  }

  /** 在收到批判后修正评估（流式） */
  reviseStream(
    imageUrl: string,
    originalProposal: ProposerResult,
    critiqueResult: CritiqueResult,
    critiqueThinking: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<ProposerResult>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareRevision(
      genre,
      originalProposal,
      critiqueResult,
      critiqueThinking,
      context,
    );
    return this.callStream<ProposerResult>(systemPrompt, userPrompt, imageUrl, schema, this.#revisionConfig);
  }
}
