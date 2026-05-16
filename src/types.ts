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
  thinking?: {
    enabled: boolean;
    budget_tokens?: number;
  };
  /** Provider-specific extra parameters */
  extra?: Record<string, unknown>;
}

/** Response from an LLM chat call */
export interface ChatResponse {
  content: string;
  thinking: string | null;
  raw?: unknown;
}

/** LLM Provider interface - the core abstraction for multi-model support */
export interface LLMProvider {
  /** Execute a chat completion */
  chat(params: ChatParams): Promise<ChatResponse>;

  /** Execute a streaming chat completion, yielding chunks in real-time */
  chatStream?(params: ChatParams): AsyncIterable<StreamChunk>;

  /** Whether this provider supports vision/image inputs */
  readonly supportsVision: boolean;

  /** Whether this provider supports thinking/chain-of-thought */
  readonly supportsThinking: boolean;

  /** Provider name for logging/debugging */
  readonly name: string;
}

// ─── Streaming Types ─────────────────────────────────────

/** Granularity mode for streaming evaluation */
export type StreamMode = 'values' | 'updates';

/** Single chunk yielded by a provider's chatStream */
export interface StreamChunk {
  /** Thinking/reasoning content delta */
  thinking?: string;
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
  /** Enable chain-of-thought reasoning */
  enableThinking?: boolean;
  /** Token budget for thinking */
  thinkingBudget?: number;
  /** Temperature for generation */
  temperature?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
}

/** Result from an agent call */
export interface AgentCallResult<T = unknown> {
  result: T;
  thinking: string | null;
}

/** Agent call configuration override */
export interface CallConfig {
  model?: string;
  enableThinking?: boolean;
  thinkingBudget?: number;
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

/** Per-agent thinking configuration */
export interface AgentThinkingConfig {
  /** 是否启用思考（覆盖全局 enabled） */
  enabled?: boolean;
  /** 思考 token 预算 */
  budget?: number;
}

/** Thinking configuration — 支持全局默认 + 按角色覆盖 */
export interface ThinkingConfig {
  /** 全局默认（不配默认 false），可被 agents 按角色覆盖 */
  enabled?: boolean;
  /** 按 Agent 角色单独配置 */
  agents?: Partial<Record<AgentRole, AgentThinkingConfig>>;
}

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
  /** OpenAI-compatible API base URL */
  baseURL: string;
  /** API key */
  apiKey: string;
  /** Default model for all agents (can be overridden per agent) */
  defaultModel?: string;
  /** Per-agent model assignments */
  models?: ModelConfig;
  /** Custom provider instances for advanced routing */
  providers?: ProviderConfig;
  /** Chain-of-thought configuration */
  thinking?: ThinkingConfig;
  /** Maximum retry attempts for agent LLM calls (default: 3 per agent) */
  maxRetries?: number;
  /** Request timeout in milliseconds (passed to LLM provider) */
  timeout?: number;
  /** Event callback for observability */
  onEvent?: (event: EvaluationEvent) => void;
}

// ─── Adapter Types ────────────────────────────────────────

/** Options for creating an adapter */
export interface AdapterOptions {
  /** URL path prefix, e.g. '/api' */
  prefix?: string;
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
  | { type: 'genre_detected'; data: { genre: Genre; thinking: string | null }; timestamp: number }
  | { type: 'agent_call'; round: number; agent: string; timestamp: number }
  | { type: 'thinking_chunk'; agent: string; content: string; timestamp: number }
  | { type: 'result_chunk'; agent: string; partial: Record<string, unknown>; timestamp: number }
  | {
      type: 'agent_complete';
      round: number;
      agent: string;
      data: { result: unknown; thinking: string | null };
      timestamp: number;
    }
  | { type: 'evaluation_complete'; data: EvaluationResult; timestamp: number }
  | { type: 'error'; error: { message: string; code?: string }; timestamp: number };
