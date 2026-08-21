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

/** Reasoning effort level (superset of OpenAI Responses API and Chat Completions values) */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';

/** Per-agent reasoning configuration */
export interface AgentReasoningConfig {
  effort: ReasoningEffort;
  budgetTokens?: number;
}

/** Engine-level reasoning configuration with optional per-agent overrides */
export interface ReasoningConfig {
  /** Whether reasoning is enabled globally (default: true when this object is present). Set to `false` to disable reasoning for all agents. */
  enabled?: boolean;
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
  /** Reasoning summary mode (Responses API only) */
  summary?: 'auto' | 'concise' | 'detailed';
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
  /** Structured output support: 'json_schema' (strict) or 'json_object' (basic) */
  structuredOutput?: 'json_object' | 'json_schema';
}

/** Token usage statistics from an LLM call */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
}

// ─── Structured Output Types ─────────────────────────────

/** Structured output format specification */
export type ResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: Record<string, unknown>; description?: string; strict?: boolean };

// ─── LLM Provider Types ──────────────────────────────────

/** Content types for multi-modal messages */
export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Chat message */
export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

/** Parameters for an LLM chat call */
export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: ResponseFormat;
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
  /** Token usage statistics (typically present in the final streaming chunk when include_usage is enabled) */
  usage?: TokenUsage;
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
  /** Provider override for this call (e.g. route the revision round to a dedicated provider) */
  provider?: LLMProvider;
}

// ─── Evaluation Result Types ──────────────────────────────

/** Structured, independently renderable improvement suggestions */
export type Suggestions = string[];

/** Arbiter decision applied to a challenged dimension, scene classification, or ranking */
export type ArbitrationDecisionType = 'accept' | 'partial' | 'reject' | 'consensus';

export interface ArbitrationDecision {
  target: string;
  decision: ArbitrationDecisionType;
  reason: string;
}

/** Raw arbitration notes emitted by an agent (snake_case) */
export interface RawArbitrationNotes {
  scene_type_ruling: string;
  decisions: ArbitrationDecision[];
  final_rationale: string;
}

/** Public arbitration notes exposed by final engine results (camelCase) */
export interface ArbitrationNotes {
  sceneTypeRuling: string;
  decisions: ArbitrationDecision[];
  finalRationale: string;
}
// G 默认为 Genre 时保持宽松（Record<string, number> / string），兼容引擎内部跨门类通用代码；
// 显式指定门类（如 ProposerResult<'portrait'>）获得精确的维度键名和子类型约束。

/** Per-genre aesthetic assessment */
export type ProposerResult<G extends Genre = Genre> = {
  // 当 G 是默认 Genre 联合时，scene_type 退化为 string（跨门类通用）
  scene_type: [G] extends [Genre] ? string : SubtypeForGenre<G>;
  total_score: number;
  dimensions: [G] extends [Genre] ? Record<string, number> : Record<DimensionForGenre<G>, number>;
  critique: string;
  suggestions: Suggestions;
};

/** Arbitration result — extends ProposerResult with arbitration notes */
export type ArbitrationResult<G extends Genre = Genre> = ProposerResult<G> & {
  arbitration_notes: RawArbitrationNotes;
};

/** Complete evaluation result from the engine */
export interface EvaluationResult {
  imageUrl: string;
  genre: Genre;
  sceneType: string;
  totalScore: number;
  dimensions: Record<string, number>;
  critique: string;
  suggestions: Suggestions;
  arbitrationNotes: ArbitrationNotes;

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

  /**
   * Called before a group evaluation starts (both sync and stream endpoints).
   * Receives the validated group request params, can transform and return modified params.
   */
  beforeEvaluateGroup?: (params: GroupEvaluateParams) => Promise<GroupEvaluateParams> | GroupEvaluateParams;
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

// ─── Group Evaluation Types ──────────────────────────────

/** 组图评估模式：joint（联合评估）| compare（对比评估） */
export type GroupEvaluationMode = 'joint' | 'compare';

/** Options for evaluateGroup */
export interface GroupEvaluateOptions {
  /** Pre-specified genre (skips auto-detection) */
  genre?: Genre | null;
  /** Additional evaluation context (EXIF data, etc.) */
  context?: EvaluationContext;
  /** Whether to include per-image details in the result (default: false) */
  includePerImage?: boolean;
}

/** Options for evaluateGroupStream */
export interface GroupEvaluateStreamOptions extends GroupEvaluateOptions {
  /** Streaming granularity mode (default: 'values') */
  mode?: StreamMode;
}

/** 单张图片的逐图评估明细 */
export interface PerImageDetail {
  /** 图片在输入数组中的下标（从 0 开始） */
  index: number;
  score: number;
  comment: string;
}

/** 组图联合评估 — Proposer 原始输出（snake_case） */
export interface GroupJointProposerResult {
  scene_type: string;
  total_score: number;
  dimensions: Record<string, number>;
  group_analysis: string;
  critique: string;
  suggestions: Suggestions;
  per_image?: PerImageDetail[];
}

/** 组图对比评估 — Proposer 原始输出（snake_case） */
export interface GroupCompareProposerResult {
  ranking: Array<{ index: number; rank: number; score: number; rationale: string }>;
  comparison_summary: string;
  suggestions: Suggestions;
  per_image?: PerImageDetail[];
}

/** 组图联合评估 — Arbiter 原始输出 */
export type GroupJointArbitrationResult = GroupJointProposerResult & {
  arbitration_notes: RawArbitrationNotes;
};

/** 组图对比评估 — Arbiter 原始输出 */
export type GroupCompareArbitrationResult = GroupCompareProposerResult & {
  arbitration_notes: RawArbitrationNotes;
};

/** 组图评估结果元数据 */
export interface GroupEvaluationMetadata {
  evaluatedAt: string;
  durationMs: number;
  rounds: 3 | 4;
  imageCount: number;
  includePerImage: boolean;
  context?: EvaluationContext;
}

/** 组图联合评估最终结果 */
export interface GroupJointEvaluationResult {
  imageUrls: string[];
  mode: 'joint';
  genre: Genre;
  sceneType: string;
  totalScore: number;
  dimensions: Record<string, number>;
  groupAnalysis: string;
  critique: string;
  suggestions: Suggestions;
  arbitrationNotes: ArbitrationNotes;
  perImage?: PerImageDetail[];

  process: {
    genreDetection?: AgentCallResult<{ genre: Genre; confidence: number }>;
    proposal: AgentCallResult<GroupJointProposerResult>;
    critique: AgentCallResult<CritiqueResult>;
    revision?: AgentCallResult<GroupJointProposerResult>;
    arbitration: AgentCallResult<GroupJointArbitrationResult>;
  };

  metadata: GroupEvaluationMetadata;
}

/** 组图对比评估最终结果 */
export interface GroupCompareEvaluationResult {
  imageUrls: string[];
  mode: 'compare';
  genre: Genre;
  ranking: Array<{ index: number; rank: number; score: number; rationale: string }>;
  comparisonSummary: string;
  suggestions: Suggestions;
  arbitrationNotes: ArbitrationNotes;
  perImage?: PerImageDetail[];

  process: {
    genreDetection?: AgentCallResult<{ genre: Genre; confidence: number }>;
    proposal: AgentCallResult<GroupCompareProposerResult>;
    critique: AgentCallResult<CritiqueResult>;
    revision?: AgentCallResult<GroupCompareProposerResult>;
    arbitration: AgentCallResult<GroupCompareArbitrationResult>;
  };

  metadata: GroupEvaluationMetadata;
}

/** 组图评估最终结果（判别联合，按 mode 收窄） */
export type GroupEvaluationResult = GroupJointEvaluationResult | GroupCompareEvaluationResult;

/** 组图流式评估事件（复用单图事件中与图片无关的成员形状） */
export type GroupEvaluationStreamEvent =
  | {
      type: 'group_evaluation_start';
      data: { imageUrls: string[]; mode: GroupEvaluationMode; genre: Genre };
      timestamp: number;
    }
  | Extract<
      EvaluationStreamEvent,
      { type: 'genre_detected' | 'agent_call' | 'reasoning_chunk' | 'result_chunk' | 'agent_complete' | 'error' }
    >
  | { type: 'group_evaluation_complete'; data: GroupEvaluationResult; timestamp: number };

/**
 * Validated group evaluate request parameters passed through adapter hooks.
 *
 * Represents the normalized shape of an `/evaluate/group` (or stream variant)
 * request body after Zod validation, ready to be forwarded to the engine.
 */
export interface GroupEvaluateParams {
  imageUrls: string[];
  mode: GroupEvaluationMode;
  genre: Genre | null;
  context?: EvaluationContext;
  includePerImage?: boolean;
  streamMode?: StreamMode;
}

/** Group evaluation request body (used by adapters) */
export interface GroupEvaluateRequestBody {
  imageUrls: string[];
  mode: GroupEvaluationMode;
  genre?: Genre;
  context?: EvaluationContext;
  includePerImage?: boolean;
  /** Stream granularity for the streaming group endpoint */
  streamMode?: StreamMode;
}
