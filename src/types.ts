// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Type Definitions
 *
 * Central type definitions for the Venus AI Photography Evaluation Engine.
 */

// Re-export schema-inferred types (single source of truth)
import type {
  Genre,
  GenreConfig,
  GenreMetadata,
  ExifData,
  EvaluationContext,
  CritiqueChallenge,
  SceneTypeReview,
  CritiqueResult,
  SubtypeForGenre,
  DimensionForGenre,
} from './schema/index.js';

export type {
  Genre,
  GenreConfig,
  GenreMetadata,
  ExifData,
  EvaluationContext,
  CritiqueChallenge,
  SceneTypeReview,
  CritiqueResult,
  SubtypeForGenre,
  DimensionForGenre,
};

// ─── Agent Role ──────────────────────────────────────────

/** Agent role identifiers used across engine config */
export type AgentRole = 'genreDetector' | 'proposer' | 'critic' | 'arbiter' | 'revision';

// ─── Reasoning Types ─────────────────────────────────────

/** Reasoning effort level (aligned with OpenAI Reasoning API) */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/** Per-agent reasoning configuration */
export interface AgentReasoningConfig {
  effort: ReasoningEffort;
  budgetTokens?: number;
}

/** Engine-level reasoning configuration with optional per-agent overrides */
export interface ReasoningConfig {
  /** Default reasoning effort applied to all agents (when set) */
  effort?: ReasoningEffort;
  /** Default token budget for reasoning */
  budgetTokens?: number;
  /** Per-agent overrides; set to `false` to disable reasoning for a specific agent */
  agents?: Partial<Record<AgentRole, AgentReasoningConfig | false>>;
}

/** Per-call reasoning parameters passed to a provider */
export interface ChatReasoningParams {
  effort: ReasoningEffort;
  budgetTokens?: number;
}

/** Provider feature capabilities */
export interface ProviderCapabilities {
  /** Whether the provider supports reasoning/chain-of-thought */
  reasoning: boolean;
  /** Whether the provider supports a tunable reasoning token budget */
  reasoningBudget: boolean;
  /** Whether the provider supports vision/image inputs */
  vision: boolean;
  /** Whether the provider supports streaming */
  streaming: boolean;
}

/** Token usage statistics from an LLM call */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
}

// ─── LLM Provider Types ──────────────────────────────────

/** Content types for multi-modal messages */
export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Chat message */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

/** Parameters for an LLM chat call */
export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: { type: 'json_object' };
  /** Reasoning configuration for this call */
  reasoning?: ChatReasoningParams;
  /** Provider-specific extra parameters */
  extra?: Record<string, unknown>;
}

/** Response from an LLM chat call */
export interface ChatResponse {
  content: string;
  /** Reasoning/chain-of-thought content emitted by the model */
  reasoning: string | null;
  /** Token usage statistics, when reported by the provider */
  usage?: TokenUsage;
  raw?: unknown;
}

/** LLM Provider interface - the core abstraction for multi-model support */
export interface LLMProvider {
  /** Execute a chat completion */
  chat(params: ChatParams): Promise<ChatResponse>;

  /** Execute a streaming chat completion, yielding chunks in real-time */
  chatStream?(params: ChatParams): AsyncIterable<StreamChunk>;

  /** Provider feature capabilities */
  readonly capabilities: ProviderCapabilities;

  /** Provider name for logging/debugging */
  readonly name: string;
}

// ─── Streaming Types ─────────────────────────────────────

/** Granularity mode for streaming evaluation */
export type StreamMode = 'values' | 'updates';

/** Single chunk yielded by a provider's chatStream */
export interface StreamChunk {
  /** Reasoning content delta */
  reasoning?: string;
  /** Content text delta */
  content?: string;
  /** Incrementally parsed JSON partial (available when content is JSON) */
  partial?: Record<string, unknown>;
}

/** Options for evaluateStream */
export interface EvaluateStreamOptions {
  /** Pre-specified genre (skips auto-detection) */
  genre?: Genre | null;
  /** Additional evaluation context (EXIF data, etc.) */
  context?: EvaluationContext;
  /** Streaming granularity mode (default: 'values') */
  mode?: StreamMode;
}

// ─── Agent Types ──────────────────────────────────────────

/** Configuration for a single agent */
export interface AgentConfig {
  /** Model identifier to use */
  model: string;
  /** Reasoning configuration for this agent */
  reasoning?: ChatReasoningParams;
  /** Temperature for generation */
  temperature?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
}

/** Result from an agent call */
export interface AgentCallResult<T = unknown> {
  result: T;
  /** Reasoning/chain-of-thought content emitted by the model */
  reasoning: string | null;
}

/** Agent call configuration override */
export interface CallConfig {
  model?: string;
  reasoning?: ChatReasoningParams;
  temperature?: number;
}

// ─── Evaluation Result Types ──────────────────────────────
// G 默认为 Genre 时保持宽松（Record<string, number> / string），兼容引擎内部跨门类通用代码；
// 显式指定门类（如 ProposerResult<'portrait'>）获得精确的维度键名和子类型约束。

/** Per-genre aesthetic assessment */
export type ProposerResult<G extends Genre = Genre> = {
  // 当 G 是默认 Genre 联合时，scene_type 退化为 string（跨门类通用）
  scene_type: [G] extends [Genre] ? string : SubtypeForGenre<G>;
  total_score: number;
  dimensions: [G] extends [Genre] ? Record<string, number> : Record<DimensionForGenre<G>, number>;
  critique: string;
  suggestions: string;
};

/** Arbitration result — extends ProposerResult with arbitration notes */
export type ArbitrationResult<G extends Genre = Genre> = ProposerResult<G> & {
  arbitration_notes: string;
};

/** Complete evaluation result from the engine */
export interface EvaluationResult {
  imageUrl: string;
  genre: Genre;
  sceneType: string;
  totalScore: number;
  dimensions: Record<string, number>;
  critique: string;
  suggestions: string;
  arbitrationNotes: string;

  process: {
    genreDetection?: AgentCallResult<{ genre: Genre; confidence: number }>;
    proposal: AgentCallResult<ProposerResult>;
    critique: AgentCallResult<CritiqueResult>;
    revision?: AgentCallResult<ProposerResult>;
    arbitration: AgentCallResult<ArbitrationResult>;
  };

  metadata: {
    evaluatedAt: string;
    durationMs: number;
    rounds: 3 | 4;
    context?: EvaluationContext;
  };
}

// ─── Engine Configuration ─────────────────────────────────

/** Agent model assignments */
export type ModelConfig = Partial<Record<AgentRole, string>>;

/** Agent-specific provider overrides */
export type ProviderConfig = Partial<Record<AgentRole, LLMProvider>>;

/** Event emitted during evaluation */
export interface EvaluationEvent {
  type: 'round_start' | 'round_complete' | 'agent_call' | 'agent_complete' | 'error';
  round?: number;
  agent?: string;
  data?: unknown;
  timestamp: number;
}

/** Configuration for VenusEngine */
export interface VenusEngineConfig {
  /** LLM provider instance (required — construct and pass a provider) */
  provider: LLMProvider;
  /** Default model for all agents (can be overridden per agent) */
  defaultModel?: string;
  /** Per-agent model assignments */
  models?: ModelConfig;
  /** Custom provider instances for advanced routing */
  providers?: ProviderConfig;
  /** Reasoning configuration (replaces legacy `thinking`) */
  reasoning?: ReasoningConfig;
  /** Maximum retry attempts for agent LLM calls (default: 3 per agent) */
  maxRetries?: number;
  /** Event callback for observability */
  onEvent?: (event: EvaluationEvent) => void;
}

// ─── Adapter Types ────────────────────────────────────────

/**
 * Validated evaluate request parameters passed through adapter hooks.
 *
 * Represents the normalized shape of an `/evaluate` (or stream variant) request
 * body after Zod validation, ready to be forwarded to the engine.
 */
export interface EvaluateParams {
  imageUrl: string;
  genre: Genre | null;
  context?: EvaluationContext;
  mode?: StreamMode;
}

/** Lifecycle hooks for adapter request transformation */
export interface AdapterHooks {
  /**
   * Called before evaluation starts (both sync and stream endpoints).
   * Receives the validated request params, can transform and return modified params.
   *
   * Use cases: upload image to provider file API, inject EXIF context,
   * override genre, switch streaming granularity, etc.
   */
  beforeEvaluate?: (params: EvaluateParams) => Promise<EvaluateParams> | EvaluateParams;
}

/** Options for creating an adapter */
export interface AdapterOptions {
  /** URL path prefix, e.g. '/api' */
  prefix?: string;
  /** Lifecycle hooks for request transformation */
  hooks?: AdapterHooks;
}

/** Evaluation request body (used by adapters) */
export interface EvaluateRequestBody {
  imageUrl: string;
  genre?: Genre;
  context?: EvaluationContext;
}

/** Metadata response (used by adapters) */
export interface MetadataResponse {
  genres: Record<string, GenreMetadata>;
}

// ─── Streaming Types ─────────────────────────────────────

/** 流式评估事件 */
export type EvaluationStreamEvent =
  | { type: 'evaluation_start'; data: { imageUrl: string; genre: Genre }; timestamp: number }
  | { type: 'genre_detected'; data: { genre: Genre; reasoning: string | null }; timestamp: number }
  | { type: 'agent_call'; round: number; agent: string; timestamp: number }
  | { type: 'reasoning_chunk'; agent: string; content: string; timestamp: number }
  | { type: 'result_chunk'; agent: string; partial: Record<string, unknown>; timestamp: number }
  | {
      type: 'agent_complete';
      round: number;
      agent: string;
      data: { result: unknown; reasoning: string | null };
      timestamp: number;
    }
  | { type: 'evaluation_complete'; data: EvaluationResult; timestamp: number }
  | { type: 'error'; error: { message: string; code?: string }; timestamp: number };
