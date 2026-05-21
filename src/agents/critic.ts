// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  AgentCallResult,
  AgentConfig,
  CritiqueResult,
  EvaluationContext,
  Genre,
  LLMProvider,
  ProposerResult,
  StreamChunk,
} from '../types.js';
import { BaseAgent } from './base-agent.js';
import { getSchemas } from '../schema/index.js';
import { getCriticSystemPrompt, getCriticUserPrompt } from '../prompts/critic.js';

export class CriticAgent extends BaseAgent {
  constructor(provider: LLMProvider, config: AgentConfig) {
    super('批判者(Critic)', provider, config);
  }

  /** 组装 attack 调用参数 */
  #prepareAttack(
    genre: Genre,
    proposalResult: ProposerResult,
    proposerReasoning: string | null,
    context?: EvaluationContext,
  ) {
    const { critiqueSchema } = getSchemas(genre);
    return {
      schema: critiqueSchema,
      systemPrompt: getCriticSystemPrompt(genre),
      userPrompt: getCriticUserPrompt(genre, proposalResult, proposerReasoning, context),
    };
  }

  /** 攻击提案者的评估 */
  async attack(
    imageUrl: string,
    proposalResult: ProposerResult,
    proposerReasoning: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): Promise<AgentCallResult<CritiqueResult>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareAttack(genre, proposalResult, proposerReasoning, context);
    return await this.call(systemPrompt, userPrompt, imageUrl, schema);
  }

  /** 攻击提案者的评估（流式） */
  attackStream(
    imageUrl: string,
    proposalResult: ProposerResult,
    proposerReasoning: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<CritiqueResult>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareAttack(genre, proposalResult, proposerReasoning, context);
    return this.callStream<CritiqueResult>(systemPrompt, userPrompt, imageUrl, schema);
  }
}
