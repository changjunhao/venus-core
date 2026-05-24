// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type {
  VenusEngineConfig,
  EvaluationResult,
  EvaluationEvent,
  EvaluationStreamEvent,
  EvaluateStreamOptions,
  StreamMode,
  StreamChunk,
  Genre,
  AgentRole,
  LLMProvider,
  AgentCallResult,
  ProposerResult,
  CritiqueResult,
  ArbitrationResult,
  EvaluationContext,
  ChatReasoningParams,
} from './types.js';
import { ProposerAgent } from './agents/proposer.js';
import { CriticAgent } from './agents/critic.js';
import { ArbiterAgent } from './agents/arbiter.js';
import { GenreDetectorAgent } from './agents/genre-detector.js';
import { getProposerResultSchema, getGenreConfig } from './schema/index.js';
import { VenusError } from './utils/errors.js';
import { createLogger } from './utils/logger.js';
import { z } from 'zod';

/**
 * VenusEngine — 核心编排器
 *
 * 管理四轮对抗评估流程：
 * 1. 门类检测（如未指定）
 * 2. Proposer 初评
 * 3. Critic 攻击
 * 4. 条件修正（severity === HIGH）
 * 5. Arbiter 裁决
 */
export class VenusEngine {
  #config: VenusEngineConfig;
  #defaultProvider: LLMProvider;
  #logger;

  constructor(config: VenusEngineConfig) {
    this.#config = config;
    this.#defaultProvider = config.provider;
    this.#logger = createLogger('venus-engine');
  }

  /** Emit an evaluation event to the configured callback */
  #emit(event: Omit<EvaluationEvent, 'timestamp'>): void {
    this.#config.onEvent?.({ ...event, timestamp: Date.now() });
  }

  /** Build the genre detector agent */
  #buildGenreDetector(): GenreDetectorAgent {
    return new GenreDetectorAgent(this.#getProvider('genreDetector'), {
      model: this.#getModel('genreDetector'),
      reasoning: this.#getReasoningConfig('genreDetector'),
      maxRetries: this.#config.maxRetries,
    });
  }

  /** Build all agents for an evaluation run (per-agent reasoning config) */
  #buildAgents() {
    const proposerCfg = this.#getAgentConfig('proposer');
    const revCfg = this.#getAgentConfig('revision');
    const proposer = new ProposerAgent(
      proposerCfg.provider,
      {
        model: proposerCfg.model,
        reasoning: proposerCfg.reasoning,
        maxRetries: this.#config.maxRetries,
      },
      { model: revCfg.model, reasoning: revCfg.reasoning },
    );

    const criticCfg = this.#getAgentConfig('critic');
    const critic = new CriticAgent(criticCfg.provider, {
      model: criticCfg.model,
      reasoning: criticCfg.reasoning,
      maxRetries: this.#config.maxRetries,
    });

    const arbiterCfg = this.#getAgentConfig('arbiter');
    const arbiter = new ArbiterAgent(arbiterCfg.provider, {
      model: arbiterCfg.model,
      reasoning: arbiterCfg.reasoning,
      maxRetries: this.#config.maxRetries,
    });

    return { proposer, critic, arbiter };
  }

  /** Build the final EvaluationResult from agent outputs */
  #buildResult(
    imageUrl: string,
    detectedGenre: Genre,
    genreDetectionOut: AgentCallResult<{ genre: Genre; confidence: number }> | undefined,
    proposalOut: AgentCallResult<ProposerResult>,
    critiqueOut: AgentCallResult<CritiqueResult>,
    revisionOut: AgentCallResult<ProposerResult> | undefined,
    arbitrationOut: AgentCallResult<ArbitrationResult>,
    startTime: number,
    context?: EvaluationContext,
  ): EvaluationResult {
    const arb = arbitrationOut.result;
    const duration = Date.now() - startTime;
    const rounds: 3 | 4 = critiqueOut.result.severity === 'HIGH' ? 4 : 3;

    const result: EvaluationResult = {
      imageUrl,
      genre: detectedGenre,
      sceneType: arb.scene_type,
      totalScore: arb.total_score,
      dimensions: arb.dimensions,
      critique: arb.critique,
      suggestions: arb.suggestions,
      arbitrationNotes: arb.arbitration_notes,
      process: {
        genreDetection: genreDetectionOut,
        proposal: proposalOut,
        critique: critiqueOut,
        revision: revisionOut,
        arbitration: arbitrationOut,
      },
      metadata: {
        evaluatedAt: new Date().toISOString(),
        durationMs: duration,
        rounds,
        context: context,
      },
    };

    // Schema validation
    try {
      const resultSchema = getProposerResultSchema(detectedGenre);
      resultSchema.parse(result);
      this.#logger.info(`结果验证通过 (genre=${detectedGenre}, score=${result.totalScore})`);
    } catch (e) {
      const detail =
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : (e as Error).message;
      this.#logger.warn(`结果验证失败: ${detail}`);
    }

    return result;
  }

  /** Get the provider for a specific agent role */
  #getProvider(role: AgentRole): LLMProvider {
    const providers = this.#config.providers;
    if (providers?.[role]) {
      return providers[role]!;
    }
    return this.#defaultProvider;
  }

  /** Get the model for a specific agent role */
  #getModel(role: AgentRole): string {
    const models = this.#config.models;
    if (models?.[role]) {
      return models[role]!;
    }
    const model = this.#config.defaultModel;
    if (!model) {
      throw new VenusError(
        `No model configured for agent role '${role}'. ` +
          `Provide 'defaultModel' or per-agent 'models' in VenusEngineConfig.`,
        'CONFIG_ERROR',
      );
    }
    return model;
  }

  /**
   * Resolve effective reasoning config for a specific agent role.
   *
   * Resolution order:
   * 1. No reasoning config → undefined (standard mode)
   * 2. Per-agent override === false → undefined (explicitly disabled)
   * 3. Per-agent override (object) → use it (with global budgetTokens fallback)
   * 4. Global default effort → use it
   * 5. Otherwise → undefined (standard mode)
   */
  #getReasoningConfig(role: AgentRole): ChatReasoningParams | undefined {
    const config = this.#config.reasoning;
    if (!config) return undefined;

    const agentOverride = config.agents?.[role];

    // Explicitly disabled for this role
    if (agentOverride === false) return undefined;

    // Agent-level config takes priority
    if (agentOverride) {
      return {
        effort: agentOverride.effort,
        budgetTokens: agentOverride.budgetTokens ?? config.budgetTokens,
      };
    }

    // Fall back to global default
    if (config.effort) {
      return {
        effort: config.effort,
        budgetTokens: config.budgetTokens,
      };
    }

    return undefined;
  }

  /** Augment context with genre detection reasoning (shared by evaluate / evaluateStream) */
  #augmentContextWithGenreReasoning(
    context: EvaluationContext | undefined,
    genreDetectionOut: AgentCallResult<{ genre: Genre; confidence: number }> | undefined,
  ): EvaluationContext | undefined {
    if (!genreDetectionOut?.reasoning) return context;
    return context
      ? { ...context, genreDetectionReasoning: genreDetectionOut.reasoning }
      : { genreDetectionReasoning: genreDetectionOut.reasoning };
  }

  /** Detect the genre of an image (returns full AgentCallResult including reasoning for downstream propagation) */
  async #detectGenre(imageUrl: string): Promise<AgentCallResult<{ genre: Genre; confidence: number }>> {
    const detector = this.#buildGenreDetector();
    return await detector.detect(imageUrl);
  }

  /** Resolve genre (auto-detect or use provided) and build augmented context */
  async #resolveGenreAndContext(
    imageUrl: string,
    genre: Genre | null | undefined,
    context: EvaluationContext | undefined,
  ): Promise<{
    detectedGenre: Genre;
    genreDetectionOut: AgentCallResult<{ genre: Genre; confidence: number }> | undefined;
    augmentedContext: EvaluationContext | undefined;
  }> {
    let detectedGenre: Genre;
    let genreDetectionOut: AgentCallResult<{ genre: Genre; confidence: number }> | undefined;

    if (!genre) {
      genreDetectionOut = await this.#detectGenre(imageUrl);
      detectedGenre = genreDetectionOut.result.genre;
    } else {
      detectedGenre = genre;
    }

    const augmentedContext = this.#augmentContextWithGenreReasoning(context, genreDetectionOut);

    return { detectedGenre, genreDetectionOut, augmentedContext };
  }

  /** Retrieve agent config tuple (provider, model, reasoning settings) */
  #getAgentConfig(role: AgentRole) {
    const provider = this.#getProvider(role);
    const model = this.#getModel(role);
    const reasoning = this.#getReasoningConfig(role);
    const reasoningLog = reasoning
      ? `effort=${reasoning.effort}${reasoning.budgetTokens ? `, budget=${reasoning.budgetTokens}` : ''}`
      : 'standard';
    this.#logger.debug(
      `Agent initialized: role=${role}, provider=${provider.name}, model=${model}, reasoning=${reasoningLog}`,
    );
    return { provider, model, reasoning };
  }

  /** Run a full evaluation on an image */
  async evaluate(imageUrl: string, genre?: Genre | null, context?: EvaluationContext): Promise<EvaluationResult> {
    const startTime = Date.now();

    this.#logger.info(`评估图片: ${imageUrl.slice(0, 50)}...`);

    const { detectedGenre, genreDetectionOut, augmentedContext } = await this.#resolveGenreAndContext(
      imageUrl,
      genre,
      context,
    );

    if (genreDetectionOut) {
      const genreLabel = getGenreConfig(detectedGenre).label;
      this.#logger.info(`检测结果: ${genreLabel}${genreDetectionOut.reasoning ? ' (有推理链)' : ''}`);
    }

    this.#emit({ type: 'round_start', round: 0, agent: 'engine', data: { imageUrl, genre: detectedGenre } });

    try {
      // 构建 Agents
      const { proposer, critic, arbiter } = this.#buildAgents();

      // 第1轮：提案者初评
      this.#logger.info('第1轮：提案者初评');
      this.#emit({ type: 'agent_call', round: 1, agent: 'proposer' });
      const proposalOut: AgentCallResult<ProposerResult> = await proposer.evaluate(
        imageUrl,
        detectedGenre,
        augmentedContext,
      );
      this.#emit({
        type: 'agent_complete',
        round: 1,
        agent: 'proposer',
        data: { result: proposalOut.result, reasoning: proposalOut.reasoning },
      });
      this.#emit({ type: 'round_complete', round: 1 });
      this.#logger.info(`初始总分: ${proposalOut.result.total_score}`);

      // 第2轮：批判者攻击
      this.#logger.info('第2轮：批判者攻击');
      this.#emit({ type: 'agent_call', round: 2, agent: 'critic' });
      const critiqueOut: AgentCallResult<CritiqueResult> = await critic.attack(
        imageUrl,
        proposalOut.result,
        proposalOut.reasoning,
        detectedGenre,
        augmentedContext,
      );
      this.#emit({
        type: 'agent_complete',
        round: 2,
        agent: 'critic',
        data: { result: critiqueOut.result, reasoning: critiqueOut.reasoning },
      });
      this.#emit({ type: 'round_complete', round: 2 });
      const critiqueSeverity = critiqueOut.result.severity;
      this.#logger.info(`严重程度: ${critiqueSeverity}`);

      // 第3轮：条件分支
      let revisionOut: AgentCallResult<ProposerResult> | undefined;
      if (critiqueSeverity === 'HIGH') {
        this.#logger.info('第3轮：提案者修正（严重程度 HIGH）');
        this.#emit({ type: 'agent_call', round: 3, agent: 'proposer' });
        revisionOut = await proposer.revise(
          imageUrl,
          proposalOut.result,
          critiqueOut.result,
          critiqueOut.reasoning,
          detectedGenre,
          augmentedContext,
        );
        this.#emit({
          type: 'agent_complete',
          round: 3,
          agent: 'proposer',
          data: { result: revisionOut.result, reasoning: revisionOut.reasoning },
        });
        this.#emit({ type: 'round_complete', round: 3 });
        this.#logger.info(`修正总分: ${revisionOut.result.total_score}`);
      }

      // 第4轮：仲裁者裁决
      const finalRound = critiqueSeverity === 'HIGH' ? 4 : 3;
      this.#logger.info('最终轮：仲裁者裁决');
      this.#emit({ type: 'agent_call', round: finalRound, agent: 'arbiter' });
      const arbitrationOut: AgentCallResult<ArbitrationResult> = await arbiter.decide(
        imageUrl,
        proposalOut.result,
        critiqueOut.result,
        revisionOut?.result ?? null,
        proposalOut.reasoning,
        critiqueOut.reasoning,
        revisionOut?.reasoning ?? null,
        detectedGenre,
        augmentedContext,
      );
      this.#emit({
        type: 'agent_complete',
        round: finalRound,
        agent: 'arbiter',
        data: { result: arbitrationOut.result, reasoning: arbitrationOut.reasoning },
      });
      this.#emit({ type: 'round_complete', round: finalRound });
      const arb = arbitrationOut.result;
      this.#logger.info(`最终总分: ${arb.total_score}`);

      // ── 组装最终结果 ──
      const result = this.#buildResult(
        imageUrl,
        detectedGenre,
        genreDetectionOut,
        proposalOut,
        critiqueOut,
        revisionOut,
        arbitrationOut,
        startTime,
        augmentedContext,
      );

      return result;
    } catch (err) {
      this.#emit({ type: 'error', agent: 'engine', data: { error: err } });
      throw err;
    }
  }

  /**
   * Run one stream round: wrap, iterate (mode-filtered), emit events, return result.
   * Eliminates the 4× duplication in evaluateStream.
   */
  async *#runStreamRound<T>(
    stream: AsyncGenerator<StreamChunk, AgentCallResult<T>, unknown>,
    agentName: string,
    round: number,
    mode: StreamMode,
  ): AsyncGenerator<EvaluationStreamEvent, AgentCallResult<T>, unknown> {
    yield { type: 'agent_call', round, agent: agentName, timestamp: Date.now() };

    // Inline the old #wrapAgentStream logic
    let next = await stream.next();
    while (!next.done) {
      const chunk = next.value;
      // Convert provider-level StreamChunk → engine-level EvaluationStreamEvent
      const events: EvaluationStreamEvent[] = [];
      if (chunk.reasoning) {
        events.push({ type: 'reasoning_chunk', agent: agentName, content: chunk.reasoning, timestamp: Date.now() });
      }
      if (chunk.partial) {
        events.push({ type: 'result_chunk', agent: agentName, partial: chunk.partial, timestamp: Date.now() });
      }
      for (const event of events) {
        if (mode === 'updates' || (event.type !== 'reasoning_chunk' && event.type !== 'result_chunk')) {
          yield event;
        }
      }
      next = await stream.next();
    }
    const result = next.value;

    yield {
      type: 'agent_complete',
      round,
      agent: agentName,
      data: { result: result.result, reasoning: result.reasoning },
      timestamp: Date.now(),
    };

    return result;
  }

  /** Run a streaming evaluation on an image, yielding events at each stage */
  async *evaluateStream(
    imageUrl: string,
    options?: EvaluateStreamOptions,
  ): AsyncGenerator<EvaluationStreamEvent, void, unknown> {
    const genre = options?.genre;
    const context = options?.context;
    const mode: StreamMode = options?.mode ?? 'values';
    const startTime = Date.now();

    try {
      this.#logger.info(`[stream] 评估图片: ${imageUrl.slice(0, 50)}... (mode=${mode})`);

      // ── 门类检测（支持流式）──
      let detectedGenre: Genre;
      let genreDetectionOut: AgentCallResult<{ genre: Genre; confidence: number }> | undefined;
      let augmentedContext: EvaluationContext | undefined;

      if (!genre) {
        const detector = this.#buildGenreDetector();
        genreDetectionOut = yield* this.#runStreamRound<{ genre: Genre; confidence: number }>(
          detector.detectStream(imageUrl),
          'genreDetector',
          0,
          mode,
        );
        detectedGenre = genreDetectionOut.result.genre;

        augmentedContext = this.#augmentContextWithGenreReasoning(context, genreDetectionOut);

        const genreLabel = getGenreConfig(detectedGenre).label;
        this.#logger.info(`[stream] 检测结果: ${genreLabel}${genreDetectionOut.reasoning ? ' (有推理链)' : ''}`);
        yield {
          type: 'genre_detected',
          data: { genre: detectedGenre, reasoning: genreDetectionOut.reasoning },
          timestamp: Date.now(),
        };
      } else {
        detectedGenre = genre;
        augmentedContext = context;
      }

      yield { type: 'evaluation_start', data: { imageUrl, genre: detectedGenre }, timestamp: Date.now() };

      // Build Agents
      const { proposer, critic, arbiter } = this.#buildAgents();

      // ── 第1轮：提案者初评 ──
      this.#logger.info('[stream] 第1轮：提案者初评');
      const proposalOut = yield* this.#runStreamRound<ProposerResult>(
        proposer.evaluateStream(imageUrl, detectedGenre, augmentedContext),
        'proposer',
        1,
        mode,
      );
      this.#logger.info(`[stream] 初始总分: ${proposalOut.result.total_score}`);

      // ── 第2轮：批判者攻击 ──
      this.#logger.info('[stream] 第2轮：批判者攻击');
      const critiqueOut = yield* this.#runStreamRound<CritiqueResult>(
        critic.attackStream(imageUrl, proposalOut.result, proposalOut.reasoning, detectedGenre, augmentedContext),
        'critic',
        2,
        mode,
      );
      const critiqueSeverity = critiqueOut.result.severity;
      this.#logger.info(`[stream] 严重程度: ${critiqueSeverity}`);

      // ── 第3轮：条件分支 ──
      let revisionOut: AgentCallResult<ProposerResult> | undefined;
      if (critiqueSeverity === 'HIGH') {
        this.#logger.info('[stream] 第3轮：提案者修正（严重程度 HIGH）');
        revisionOut = yield* this.#runStreamRound<ProposerResult>(
          proposer.reviseStream(
            imageUrl,
            proposalOut.result,
            critiqueOut.result,
            critiqueOut.reasoning,
            detectedGenre,
            augmentedContext,
          ),
          'proposer-revision',
          3,
          mode,
        );
        this.#logger.info(`[stream] 修正总分: ${revisionOut.result.total_score}`);
      }

      // ── 最终轮：仲裁者裁决 ──
      const finalRound = critiqueSeverity === 'HIGH' ? 4 : 3;
      this.#logger.info('[stream] 最终轮：仲裁者裁决');
      const arbitrationOut = yield* this.#runStreamRound<ArbitrationResult>(
        arbiter.decideStream(
          imageUrl,
          proposalOut.result,
          critiqueOut.result,
          revisionOut?.result ?? null,
          proposalOut.reasoning,
          critiqueOut.reasoning,
          revisionOut?.reasoning ?? null,
          detectedGenre,
          augmentedContext,
        ),
        'arbiter',
        finalRound,
        mode,
      );
      this.#logger.info(`[stream] 最终总分: ${arbitrationOut.result.total_score}`);

      // 组装最终结果
      const result = this.#buildResult(
        imageUrl,
        detectedGenre,
        genreDetectionOut,
        proposalOut,
        critiqueOut,
        revisionOut,
        arbitrationOut,
        startTime,
        augmentedContext,
      );

      yield { type: 'evaluation_complete', data: result, timestamp: Date.now() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof VenusError ? err.code : undefined;
      yield { type: 'error', error: { message, code }, timestamp: Date.now() };
    }
  }
}

/** Factory function */
export function createVenusEngine(config: VenusEngineConfig): VenusEngine {
  return new VenusEngine(config);
}
