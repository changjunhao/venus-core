// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  AgentCallResult,
  AgentConfig,
  CritiqueResult,
  EvaluationContext,
  Genre,
  GroupCompareProposerResult,
  GroupEvaluationMode,
  GroupJointProposerResult,
  LLMProvider,
  ProposerResult,
  StreamChunk,
} from '../types.js';
import { BaseAgent } from './base-agent.js';
import { getSchemas, CritiqueSchema } from '../schema/index.js';
import { getCriticSystemPrompt, getCriticUserPrompt } from '../prompts/critic.js';
import { getGroupCriticSystemPrompt, getGroupCriticUserPrompt } from '../prompts/group.js';

/** 组图 Proposer 输出联合类型（joint | compare） */
type GroupProposerOutput = GroupJointProposerResult | GroupCompareProposerResult;

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

  /** 组装 attackGroup 调用参数 */
  #prepareGroupAttack(
    mode: GroupEvaluationMode,
    genre: Genre,
    proposal: GroupProposerOutput,
    proposerReasoning: string | null,
    context?: EvaluationContext,
  ) {
    return {
      schema: CritiqueSchema,
      systemPrompt: getGroupCriticSystemPrompt(mode, genre),
      userPrompt: getGroupCriticUserPrompt(mode, genre, proposal, proposerReasoning, context),
    };
  }

  /** 攻击提案者的组图评估 */
  async attackGroup(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    proposal: GroupProposerOutput,
    proposerReasoning: string | null,
    genre: Genre,
    context?: EvaluationContext,
  ): Promise<AgentCallResult<CritiqueResult>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupAttack(
      mode,
      genre,
      proposal,
      proposerReasoning,
      context,
    );
    return await this.call<CritiqueResult>(systemPrompt, userPrompt, imageUrls, schema);
  }

  /** 攻击提案者的组图评估（流式） */
  attackGroupStream(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    proposal: GroupProposerOutput,
    proposerReasoning: string | null,
    genre: Genre,
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<CritiqueResult>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupAttack(
      mode,
      genre,
      proposal,
      proposerReasoning,
      context,
    );
    return this.callStream<CritiqueResult>(systemPrompt, userPrompt, imageUrls, schema);
  }
}
