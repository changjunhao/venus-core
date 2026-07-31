// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  AgentCallResult,
  AgentConfig,
  ArbitrationResult,
  CritiqueResult,
  EvaluationContext,
  Genre,
  GroupCompareArbitrationResult,
  GroupCompareProposerResult,
  GroupEvaluationMode,
  GroupJointArbitrationResult,
  GroupJointProposerResult,
  LLMProvider,
  ProposerResult,
  StreamChunk,
} from '../types.js';
import { BaseAgent } from './base-agent.js';
import { getSchemas } from '../schema/index.js';
import { getGroupJointSchemas, getGroupCompareSchemas } from '../schema/group.js';
import { getArbiterSystemPrompt, getArbiterUserPrompt } from '../prompts/arbiter.js';
import { getGroupArbiterSystemPrompt, getGroupArbiterUserPrompt } from '../prompts/group.js';

/** 组图 Proposer 输出联合类型（joint | compare） */
type GroupProposerOutput = GroupJointProposerResult | GroupCompareProposerResult;

/** 组图 Arbiter 输出联合类型（joint | compare，engine 侧按 mode 收窄） */
type GroupArbitrationOutput = GroupJointArbitrationResult | GroupCompareArbitrationResult;

export class ArbiterAgent extends BaseAgent {
  constructor(provider: LLMProvider, config: AgentConfig) {
    super('仲裁者(Arbiter)', provider, config);
  }

  /** 组装 decide 调用参数 */
  #prepareDecide(
    genre: Genre,
    proposalResult: ProposerResult,
    critiqueResult: CritiqueResult,
    revisionResult: ProposerResult | null,
    critiqueReasoning: string | null,
    revisionReasoning: string | null,
    context?: EvaluationContext,
  ) {
    const { arbiterSchema } = getSchemas(genre);
    return {
      schema: arbiterSchema,
      systemPrompt: getArbiterSystemPrompt(genre),
      userPrompt: getArbiterUserPrompt(
        genre,
        proposalResult,
        critiqueResult,
        revisionResult,
        critiqueReasoning,
        revisionReasoning,
        context,
      ),
    };
  }

  /** 仲裁提案者和批判者的争议 */
  async decide(
    imageUrl: string,
    proposalResult: ProposerResult,
    critiqueResult: CritiqueResult,
    revisionResult: ProposerResult | null,
    proposerReasoning: string | null,
    critiqueReasoning: string | null,
    revisionReasoning: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): Promise<AgentCallResult<ArbitrationResult>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareDecide(
      genre,
      proposalResult,
      critiqueResult,
      revisionResult,
      critiqueReasoning,
      revisionReasoning,
      context,
    );
    return await this.call(systemPrompt, userPrompt, imageUrl, schema);
  }

  /** 仲裁提案者和批判者的争议（流式） */
  decideStream(
    imageUrl: string,
    proposalResult: ProposerResult,
    critiqueResult: CritiqueResult,
    revisionResult: ProposerResult | null,
    proposerReasoning: string | null,
    critiqueReasoning: string | null,
    revisionReasoning: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<ArbitrationResult>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareDecide(
      genre,
      proposalResult,
      critiqueResult,
      revisionResult,
      critiqueReasoning,
      revisionReasoning,
      context,
    );
    return this.callStream<ArbitrationResult>(systemPrompt, userPrompt, imageUrl, schema);
  }

  /** 组装 decideGroup 调用参数 */
  #prepareGroupDecide(
    mode: GroupEvaluationMode,
    genre: Genre,
    imageCount: number,
    includePerImage: boolean,
    proposal: GroupProposerOutput,
    critique: CritiqueResult,
    revision: GroupProposerOutput | null,
    proposalReasoning: string | null,
    critiqueReasoning: string | null,
    revisionReasoning: string | null,
    context?: EvaluationContext,
  ) {
    const { arbiterSchema } =
      mode === 'joint'
        ? getGroupJointSchemas(genre, includePerImage, imageCount)
        : getGroupCompareSchemas(imageCount, includePerImage);
    return {
      schema: arbiterSchema,
      systemPrompt: getGroupArbiterSystemPrompt(mode, genre, imageCount, includePerImage),
      userPrompt: getGroupArbiterUserPrompt(
        mode,
        genre,
        proposal,
        critique,
        revision,
        proposalReasoning,
        critiqueReasoning,
        revisionReasoning,
        context,
      ),
    };
  }

  /** 仲裁组图评估中提案者和批判者的争议 */
  async decideGroup(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    proposal: GroupProposerOutput,
    critique: CritiqueResult,
    revision: GroupProposerOutput | null,
    proposalReasoning: string | null,
    critiqueReasoning: string | null,
    revisionReasoning: string | null,
    genre: Genre,
    includePerImage: boolean,
    context?: EvaluationContext,
  ): Promise<AgentCallResult<GroupArbitrationOutput>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupDecide(
      mode,
      genre,
      imageUrls.length,
      includePerImage,
      proposal,
      critique,
      revision,
      proposalReasoning,
      critiqueReasoning,
      revisionReasoning,
      context,
    );
    return await this.call<GroupArbitrationOutput>(systemPrompt, userPrompt, imageUrls, schema);
  }

  /** 仲裁组图评估中提案者和批判者的争议（流式） */
  decideGroupStream(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    proposal: GroupProposerOutput,
    critique: CritiqueResult,
    revision: GroupProposerOutput | null,
    proposalReasoning: string | null,
    critiqueReasoning: string | null,
    revisionReasoning: string | null,
    genre: Genre,
    includePerImage: boolean,
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<GroupArbitrationOutput>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupDecide(
      mode,
      genre,
      imageUrls.length,
      includePerImage,
      proposal,
      critique,
      revision,
      proposalReasoning,
      critiqueReasoning,
      revisionReasoning,
      context,
    );
    return this.callStream<GroupArbitrationOutput>(systemPrompt, userPrompt, imageUrls, schema);
  }
}
