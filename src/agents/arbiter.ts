// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  AgentCallResult,
  AgentConfig,
  ArbitrationResult,
  CritiqueResult,
  EvaluationContext,
  Genre,
  LLMProvider,
  ProposerResult,
  StreamChunk,
} from '../types.js';
import { BaseAgent } from './base-agent.js';
import { getSchemas } from '../schema/index.js';
import { getArbiterSystemPrompt, getArbiterUserPrompt } from '../prompts/arbiter.js';

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
}
