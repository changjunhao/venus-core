// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  AgentCallResult,
  AgentConfig,
  CallConfig,
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
import { getSchemas } from '../schema/index.js';
import { getGroupJointSchemas, getGroupCompareSchemas } from '../schema/group.js';
import { getProposerSystemPrompt, getProposerUserPrompt, getRevisionUserPrompt } from '../prompts/proposer.js';
import {
  getGroupProposerSystemPrompt,
  getGroupProposerUserPrompt,
  getGroupRevisionUserPrompt,
} from '../prompts/group.js';

/** 组图 Proposer 输出联合类型（joint | compare，engine 侧按 mode 收窄） */
type GroupProposerOutput = GroupJointProposerResult | GroupCompareProposerResult;

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
    critiqueReasoning: string | null,
    context?: EvaluationContext,
  ) {
    const { proposalSchema } = getSchemas(genre);
    return {
      schema: proposalSchema,
      systemPrompt: getProposerSystemPrompt(genre),
      userPrompt: getRevisionUserPrompt(genre, originalProposal, critiqueResult, critiqueReasoning, context),
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
    critiqueReasoning: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): Promise<AgentCallResult<ProposerResult>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareRevision(
      genre,
      originalProposal,
      critiqueResult,
      critiqueReasoning,
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
    critiqueReasoning: string | null,
    genre: Genre = 'portrait',
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<ProposerResult>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareRevision(
      genre,
      originalProposal,
      critiqueResult,
      critiqueReasoning,
      context,
    );
    return this.callStream<ProposerResult>(systemPrompt, userPrompt, imageUrl, schema, this.#revisionConfig);
  }

  /** 组装 evaluateGroup 调用参数 */
  #prepareGroupEvaluate(
    mode: GroupEvaluationMode,
    genre: Genre,
    imageCount: number,
    includePerImage: boolean,
    context?: EvaluationContext,
  ) {
    const { proposalSchema } =
      mode === 'joint'
        ? getGroupJointSchemas(genre, includePerImage, imageCount)
        : getGroupCompareSchemas(imageCount, includePerImage);
    return {
      schema: proposalSchema,
      systemPrompt: getGroupProposerSystemPrompt(mode, genre, imageCount, includePerImage),
      userPrompt: getGroupProposerUserPrompt(mode, genre, imageCount, context),
    };
  }

  /** 组装 reviseGroup 调用参数 */
  #prepareGroupRevision(
    mode: GroupEvaluationMode,
    genre: Genre,
    imageCount: number,
    includePerImage: boolean,
    originalProposal: GroupProposerOutput,
    critiqueResult: CritiqueResult,
    critiqueReasoning: string | null,
    context?: EvaluationContext,
  ) {
    const { proposalSchema } =
      mode === 'joint'
        ? getGroupJointSchemas(genre, includePerImage, imageCount)
        : getGroupCompareSchemas(imageCount, includePerImage);
    return {
      schema: proposalSchema,
      systemPrompt: getGroupProposerSystemPrompt(mode, genre, imageCount, includePerImage),
      userPrompt: getGroupRevisionUserPrompt(mode, genre, originalProposal, critiqueResult, critiqueReasoning, context),
    };
  }

  /** 组图初始评估 */
  async evaluateGroup(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    genre: Genre,
    includePerImage: boolean,
    context?: EvaluationContext,
  ): Promise<AgentCallResult<GroupProposerOutput>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupEvaluate(
      mode,
      genre,
      imageUrls.length,
      includePerImage,
      context,
    );
    return await this.call<GroupProposerOutput>(systemPrompt, userPrompt, imageUrls, schema);
  }

  /** 组图在收到批判后修正评估 */
  async reviseGroup(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    originalProposal: GroupProposerOutput,
    critiqueResult: CritiqueResult,
    critiqueReasoning: string | null,
    genre: Genre,
    includePerImage: boolean,
    context?: EvaluationContext,
  ): Promise<AgentCallResult<GroupProposerOutput>> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupRevision(
      mode,
      genre,
      imageUrls.length,
      includePerImage,
      originalProposal,
      critiqueResult,
      critiqueReasoning,
      context,
    );
    return await this.call<GroupProposerOutput>(systemPrompt, userPrompt, imageUrls, schema, this.#revisionConfig);
  }

  /** 组图初始评估（流式） */
  evaluateGroupStream(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    genre: Genre,
    includePerImage: boolean,
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<GroupProposerOutput>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupEvaluate(
      mode,
      genre,
      imageUrls.length,
      includePerImage,
      context,
    );
    return this.callStream<GroupProposerOutput>(systemPrompt, userPrompt, imageUrls, schema);
  }

  /** 组图在收到批判后修正评估（流式） */
  reviseGroupStream(
    imageUrls: string[],
    mode: GroupEvaluationMode,
    originalProposal: GroupProposerOutput,
    critiqueResult: CritiqueResult,
    critiqueReasoning: string | null,
    genre: Genre,
    includePerImage: boolean,
    context?: EvaluationContext,
  ): AsyncGenerator<StreamChunk, AgentCallResult<GroupProposerOutput>, unknown> {
    const { schema, systemPrompt, userPrompt } = this.#prepareGroupRevision(
      mode,
      genre,
      imageUrls.length,
      includePerImage,
      originalProposal,
      critiqueResult,
      critiqueReasoning,
      context,
    );
    return this.callStream<GroupProposerOutput>(systemPrompt, userPrompt, imageUrls, schema, this.#revisionConfig);
  }
}
