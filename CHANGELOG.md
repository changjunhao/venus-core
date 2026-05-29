# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-05-29

### Added

- **Volcano Ark (Doubao) endpoint support**: `detectEndpointBehavior` now recognizes
  `ark.cn-beijing.volces.com` base URLs and auto-adapts reasoning parameters to
  Doubao's `thinking.type` toggle + `reasoning_effort` format.
- **`ReasoningEffort` extended to 5 levels**: `'minimal'` and `'max'` added to the
  existing `'low'` / `'medium'` / `'high'` union, with corresponding default
  token budgets (512 / 65536).
- **`thinking: { type: "disabled" }` for Volcano Ark minimal**: when
  `reasoning.effort === 'minimal'`, sends `thinking: { type: "disabled" }` to
  explicitly disable reasoning on all Doubao models.

## [0.6.0] - 2026-05-24

### BREAKING

- **Engine now requires a provider instance**: `VenusEngineConfig` no longer accepts
  `baseURL` / `apiKey` / `timeout`. Instead, callers must construct and pass an
  `LLMProvider` instance via the required `provider` field.
- **Provider factory renamed**: `createOpenAICompatProvider` → `createOpenAIChatProvider`;
  `OpenAICompatOptions` → `OpenAIChatProviderOptions`. Update all imports.
- **Reasoning adapter utilities removed from public API**: `adaptReasoningParams`,
  `detectProviderStyle`, `extractReasoningContent`, `extractStreamReasoning`,
  `extractTokenUsage`, `getDefaultBudget`, and the `ProviderStyle` type are no longer
  exported. These are now internal implementation details of each provider.
- **`defaultModel` no longer has a fallback**: previously defaulted to `qwen3-vl-flash`;
  now throws a `CONFIG_ERROR` if missing. Configure `defaultModel` or per-agent `models`
  explicitly.

### Added

- **New provider factories (experimental stubs)**: `createOpenAIResponsesProvider`,
  `createAnthropicProvider`, and `createGeminiProvider` — type definitions and
  option interfaces are exported for forward compatibility, but implementations
  are skeletons that throw on invocation. Marked `@experimental`.
- **Optional peer dependencies**: `@anthropic-ai/sdk` and `@google/genai` added
  for the upcoming Anthropic and Gemini providers.
- **Bilingual documentation**: detailed API reference, configuration guide, and usage
  guide extracted from README into `docs/en/` and `docs/zh-CN/`.
- **Skeleton provider test**: `test/providers/skeleton-providers.test.ts` validates
  basic provider instantiation and capability declarations for all providers.

### Changed

- Provider source files reorganized: `openai-compat.ts` → `openai-chat.ts`,
  `reasoning-adapter.ts` → `reasoning.ts` (internal only; public API uses new names).
- `BaseAgent` error-history push logic extracted into `#pushErrorHistory()` helper,
  shared by both `call()` and `callStream()` retry loops.
- Proposer revision prompt now enforces Chinese language for thinking and all
  natural-language text fields (critique, suggestions, etc.).
- Logger: removed unused `silentLogger` export.
- Dependency bumps: `openai` ^6.39.0, `hono` ^4.12.22, `eslint` ^10.4.0,
  `typescript-eslint` ^8.59.4.

## [0.5.0] - 2026-05-23

### Added

- **Adapter lifecycle hooks**: `AdapterHooks` with a `beforeEvaluate` hook that
  allows transforming validated request params before the engine call on all
  endpoints (`/evaluate`, `/evaluate/stream`, `/evaluate/stream/jsonl`).
  - New types: `AdapterHooks`, `EvaluateParams` exported from the main entry.
  - `createHonoAdapter()` and `createExpressAdapter()` now accept an optional
    `AdapterOptions` second parameter with `prefix` and `hooks` fields.
  - Use cases: upload image to provider file API, inject EXIF context, override
    genre, switch streaming granularity, etc.
  - Hook supports both sync and async implementations.
- Comprehensive test suite for adapter hooks (`test/adapters/hono.test.ts`,
  `test/adapters/express.test.ts`) covering sync/async/stream scenarios.
- README (EN/ZH) updated with hook documentation, type references, and usage
  examples (image pre-upload, EXIF injection).

## [0.4.0] - 2026-05-21

### Changed

- **BREAKING — Reasoning configuration system standardized across providers**:
  Replaces the previous Qwen-flavored `ThinkingConfig` with an OpenAI-aligned
  `ReasoningConfig` and a new provider-agnostic adapter layer.
  - `ThinkingConfig` / `AgentThinkingConfig` → `ReasoningConfig` /
    `AgentReasoningConfig`, exposing OpenAI-style `effort: 'minimal' | 'low' |
    'medium' | 'high'` plus optional `budgetTokens` and per-agent `enabled`
    overrides.
  - `VenusEngineConfig.thinking` → `VenusEngineConfig.reasoning`. Per-agent
    resolution is unified through `Engine#getReasoningConfig(role)` with a
    three-level precedence: per-agent override → global → disabled.
  - `BaseAgent.call()` / `callStream()` now take a single normalized
    `reasoning` parameter and pass it straight through; provider-specific shape
    translation has been moved out of the agent layer.
- **BREAKING — Streaming event renamed**: `thinking_chunk` →
  `reasoning_chunk` in `EvaluationStreamEvent` and across all SSE / JSON Lines
  outputs. Adapter consumers must update their event-type matching.
- **BREAKING — `ProviderCapabilities` shape**: `supportsVision` /
  `supportsThinking` flags replaced by a structured `capabilities` object with
  required fields `reasoning`, `reasoningBudget`, `vision`, `streaming`.
  `defineProvider` and `createOpenAICompatProvider` updated accordingly.

### Added

- **`src/providers/reasoning-adapter.ts`**: provider-agnostic adapter that
  converts the standardized `ReasoningConfig` into the native request shape for
  OpenAI, Anthropic, Qwen, Kimi, DeepSeek, and Gemini, so callers no longer
  need to know vendor-specific parameter names (`thinking`, `reasoning_effort`,
  `enable_thinking`, `thinking_budget`, etc.).
- README.md and README.zh-CN.md fully synchronized with the new reasoning API,
  including updated configuration examples, supported providers table, and
  streaming event reference.

### Migration

- Rename `thinking` → `reasoning` in `VenusEngineConfig` and per-agent
  overrides; replace boolean `enabled` semantics with the new `effort` enum
  when you want graded control (legacy `enabled: false` ≈ omitting reasoning).
- Replace stream consumers' `event.type === 'thinking_chunk'` checks with
  `'reasoning_chunk'`.
- If you implemented a custom provider, migrate to the new `capabilities`
  object on `defineProvider`.

## [0.3.2] - 2026-05-20

### Added

- **Language constraint for thinking mode**: All three agent system prompts (Proposer,
  Critic, Arbiter) now include explicit Chinese language requirements for the thinking
  process, preventing Qwen3-series models from occasionally switching to English during
  internal reasoning. The constraint specifically preserves English JSON keys and enum values.
- **Efficiency principle for Critic**: Added guidance to avoid overthinking when the
  Proposer's evaluation is already reasonable — output `LOW` severity promptly instead
  of forcing nonexistent issues.
- **Efficiency principle for Arbiter**: Added a rule to quickly confirm final scores when
  Critic severity is `LOW` (consensus scenario), avoiding redundant deliberation.
- **Dynamic LOW-severity hint in Arbiter user prompt**: When `critiqueResult.severity`
  is `'LOW'`, a contextual paragraph is injected advising the Arbiter to make a swift
  decision based on consensus.

## [0.3.1] - 2026-05-20

### Changed

- **Prompt architecture refactor**: Decoupled role definitions between Standards layer
  and Agent Prompt layer to eliminate conflicting identity instructions sent to the LLM.
  - 8 scoring standard documents (`src/prompts/standards/*.ts`) no longer contain
    first-person role definitions ("你是一位拥有20年经验的资深X摄影艺术总监...").
    They are now pure evaluation reference documents with neutral domain descriptions.
  - Agent prompt files (`proposer.ts`, `critic.ts`, `arbiter.ts`) are now the single
    source of truth for each agent's identity, with enriched professional background
    context (20-year expertise, task directives, objectivity constraints).
  - `getArbiterSystemPrompt()` now uses genre-specific `label` in the role definition
    for consistency with Proposer and Critic.

## [0.3.0] - 2026-05-19

### Fixed

- `BaseAgent.call()` and `callStream()` now always pass an explicit `{ enabled: boolean }`
  thinking object to the provider, instead of conditionally omitting the `thinking`
  parameter when disabled. This ensures `enable_thinking: false` is sent to the API,
  preventing Qwen3-series models from silently defaulting to thinking mode despite the
  engine configuration explicitly disabling it.

### Changed

- `createOpenAICompatProvider` internal implementation now uses the `defineProvider`
  factory instead of a manual object literal, aligning with the public provider API.

## [0.2.0] - 2026-05-17

### Added

- `ExifDataSchema` and `EvaluationContextSchema` Zod schemas now exported from
  `@theogony/venus-core` for consumer-side validation.
- `BaseAgent.callStream()` now includes the same retry loop and conversational
  error feedback as `call()`, with `ZodError`-aware logging and `SchemaError` on
  exhaustion.

## [0.1.0] - 2026-05-16

### Added

#### Core Engine

- `VenusEngine` class and `createVenusEngine()` factory function orchestrating a multi-agent adversarial
  evaluation pipeline.
- Four-round evaluation workflow: auto genre detection (or caller-specified) → Proposer initial
  assessment → Critic adversarial review → conditional Proposer revision (when severity is `HIGH`).
- `engine.evaluate(imageUrl, genre?, context?)` for synchronous, blocking assessment returning
  a complete `EvaluationResult`.
- `engine.evaluateStream(imageUrl, options?)` for streaming assessment via `AsyncGenerator`,
  yielding `EvaluationStreamEvent` at each pipeline stage. Supports two `StreamMode`s:
  - `'values'` (default) — yields agent-complete results only.
  - `'updates'` — additionally yields `thinking_chunk` and `result_chunk` for real-time incremental output.
- `onEvent` callback in `VenusEngineConfig` for observability into each round
  (`round_start`, `agent_call`, `agent_complete`, `round_complete`, `error`).
- Built-in structured logging via `createLogger()` with per-component prefix.

#### 8 Photography Genres

- `GenreEnum` (Zod enum) covering: `portrait`, `landscape`, `documentary`, `fine_art`,
  `commercial`, `architecture`, `nature`, `sports`.
- `GENRE_CONFIG` registry — complete per-genre configuration with Chinese labels,
  dimension keys/names, subtype keys/names, and Chinese dimension labels, using `as const satisfies`
  for literal type preservation.
- Dynamic Zod schema generation via `createProposalSchema(genre)` and
  `createArbiterSchema(genre)` with request-level caching (`proposalCache` / `arbiterCache`).
- `CritiqueSchema` — shared stateless schema for Critic output validation.
- `getProposerResultSchema(genre)` — builds the full `EvaluationResult` Zod schema with
  nested `process` (genreDetection / proposal / critique / revision / arbitration) validation.
- Public utilities: `getSchemas()`, `getGenreConfig()`, `getAllGenres()`, `getMetadata()`.

#### Multi-Agent System

- `BaseAgent` — shared base class with:
  - Retry loop (default 3 attempts) with conversational error feedback to the model.
  - JSON parsing with Zod validation via `#parseResponse()`.
  - Multi-modal message construction (text + image_url).
  - `call()` for synchronous LLM invocation; `callStream()` for streaming LLM invocation
    with automatic fallback to `call()` when the provider lacks `chatStream`.
  - Per-call thinking configuration resolution (`enableThinking` / `thinkingBudget`).
- `ProposerAgent` — initial aesthetic assessment and post-critique revision.
  Supports separate `revisionConfig` (model / thinking) for the revision round.
- `CriticAgent` — adversarial critique with scene-type review (`scene_type_review`),
  dimension-level challenges, and three-tier severity (`LOW` / `MEDIUM` / `HIGH`).
- `ArbiterAgent` — final arbitration synthesizing Proposer, Critic, and optional revision
  outputs into an authoritative `ArbitrationResult` (extends `ProposerResult` with `arbitration_notes`).
- `GenreDetectorAgent` — standalone VLM-based genre classifier yielding
  `{ genre, confidence }` with optional thinking chain.

#### Multi-Provider System

- `LLMProvider` interface — the core abstraction for LLM backends:
  - `chat(params)` → `ChatResponse` (synchronous).
  - `chatStream?(params)` → `AsyncIterable<StreamChunk>` (optional streaming).
  - `supportsVision` / `supportsThinking` / `name` capability flags.
- `createOpenAICompatProvider(options)` — OpenAI SDK-based provider:
  - Compatible with any OpenAI-format API (OpenAI, DashScope, Together, vLLM, etc.).
  - Thinking/reasoning extraction from `reasoning_content` or `thinking` fields.
  - Fine-grained error classification: `network`, `timeout`, `auth_error`, `api_error`, `parse_error`.
  - SSE streaming via `chatStream` with incremental JSON parsing via `vectorjson`.
  - Configurable `defaultExtra` for vendor-specific parameters.
- `defineProvider(options)` — factory for fully custom `LLMProvider` implementations.
- Per-agent provider routing via `providers?: ProviderConfig` and per-agent model routing
  via `models?: ModelConfig` in `VenusEngineConfig`.

#### Chain-of-Thought (Thinking) Support

- `ThinkingConfig` with global `enabled` flag and per-agent `agents` overrides
  (`AgentThinkingConfig`: `enabled?` + `budget?`).
- Per-agent thinking toggle resolution: per-agent override > global > default `false`.
- Thinking budget (`budget_tokens`) passed through to the provider as `thinking_budget`.
- Thinking chains carried through the entire pipeline via `AgentCallResult.thinking` and
  exposed in stream events (`thinking_chunk`).
- Genre detection thinking propagated to the Proposer via `EvaluationContext.genreDetectionThinking`.

#### Context Extension Interface

- `ExifData` schema (8 fields): `shutterSpeed`, `iso`, `fNumber`, `focalLength`,
  `cameraModel`, `lensModel`, `dateTimeOriginal`, `flash` — all optional and nullable.
- `EvaluationContext` schema with `exif`, `userNotes` (max 2000 chars), `custom`
  (key-value record), and internal `genreDetectionThinking`.
- Genre-differentiated EXIF injection levels in `context-formatter.ts`:
  - `high` (sports / nature) — shutter speed and focal length as primary scoring factors.
  - `standard` (landscape / portrait) — full EXIF as reference.
  - `light` (architecture / commercial / documentary) — summary only.
  - `minimal` (fine_art) — explicitly marked as reference-only.
- Role-differentiated context formatters:
  - `formatContextForProposer()` — full context + genre detection thinking.
  - `formatContextForCritic()` — summary + consistency-check prompt.
  - `formatContextForArbiter()` — base context only.
- Context returned in `EvaluationResult.metadata.context` and passed through
  Hono and Express adapters via the request body.

#### Web Framework Adapters

- `createHonoAdapter(engine, options?)` — returns a `Hono` instance with routes:
  - `POST /evaluate` — synchronous evaluation.
  - `POST /evaluate/stream` — SSE (`text/event-stream`).
  - `POST /evaluate/stream/jsonl` — Streamable HTTP / JSON Lines (`application/x-ndjson`).
  - `GET /metadata` — genre metadata endpoint.
  - Web Standards `ReadableStream`-based streaming, cross-runtime (Bun, Deno, Node, Cloudflare Workers).
- `createExpressAdapter(engine, options?)` — returns an Express `Router` with the same
  four routes, Express v5 backward compatible, with error-handling middleware.
- Shared adapter logic in `common.ts`:
  - `evaluateRequestSchema` — Zod validation for request body (`imageUrl`, `genre?`, `context?`, `mode?`).
  - `handleEvaluate()` — shared POST /evaluate handler.
  - `resolveStreamParams()` — shared stream request validation.
  - `mapErrorToResponse()` — maps `VenusError` subclasses to HTTP status codes (400 / 422 / 500).
  - `formatSSEError()` / `formatJSONLError()` — error formatting for each stream protocol.

#### Streaming API

- `EvaluationStreamEvent` discriminated union with 8 event types:
  `evaluation_start`, `genre_detected`, `agent_call`, `thinking_chunk`,
  `result_chunk`, `agent_complete`, `evaluation_complete`, `error`.
- `StreamChunk` — provider-chunk protocol: `thinking?`, `content?`, `partial?`.
- Incremental JSON parsing in `chatStream` via `vectorjson` for real-time `result_chunk` events.
- Stream mode filtering in `#runStreamRound()`: `'values'` mode suppresses
  `thinking_chunk` and `result_chunk` events.
- Both SSE (`text/event-stream`) and JSON Lines (`application/x-ndjson`) stream
  protocols supported in adapters.

#### Scoring Standards & Prompts

- 8 genre-specific professional scoring standards under `src/prompts/standards/`.
  - Shared registry `STANDARDS: Record<Genre, string>` in `prompts/shared.ts`.
- `buildDimensionsExample()`, `buildSubtypeExplanation()`, `buildDimensionList()` —
  dynamic prompt-building helpers driven by `GENRE_CONFIG`.
- Per-agent prompt factories:
  - `getProposerSystemPrompt()` / `getProposerUserPrompt()` / `getRevisionUserPrompt()`.
  - `getCriticSystemPrompt()` / `getCriticUserPrompt()`.
  - `getArbiterSystemPrompt()` / `getArbiterUserPrompt()`.
  - `getGenreDetectorSystemPrompt()` / `getGenreDetectorUserPrompt()`.
- All prompts use CoT (Chain-of-Thought) workflows with strict JSON-only output requirements.

#### Error Hierarchy

- `VenusError` — base error class with `code` property.
- `ValidationError` (code: `VALIDATION_ERROR`) — input validation failures.
- `ProviderError` (code: `PROVIDER_ERROR`) — LLM provider failures with fine-grained
  `ProviderErrorCode`: `network`, `api_error`, `parse_error`, `timeout`, `auth_error`, `unknown`,
  plus optional `statusCode`.
- `SchemaError` (code: `SCHEMA_ERROR`) — schema validation/parsing failures with
  `issues: core.$ZodIssue[]`.
- `TimeoutError` (code: `TIMEOUT_ERROR`) — evaluation timeout.

#### Type System

- `ProposerResult<G extends Genre = Genre>` — genre-generic (default) or genre-specific
  (e.g., `ProposerResult<'portrait'>`) with precise dimension key and subtype constraints.
- `ArbitrationResult<G>` extends `ProposerResult<G>` with `arbitration_notes`.
- `AgentCallResult<T>` — generic wrapper for agent outputs: `{ result: T, thinking: string | null }`.
- `VenusEngineConfig` — complete engine configuration with `baseURL`, `apiKey`,
  `defaultModel`, `models?`, `providers?`, `thinking?`, `maxRetries?`, `timeout?`, `onEvent?`.
- `SubtypeForGenre<G>` and `DimensionForGenre<G>` — precise conditional types derived
  from `GENRE_CONFIG`.
- All public types re-exported from `src/index.ts` (barrel).

#### Build & Distribution

- Dual-format build: ESM (`.js`) + CJS (`.cjs`) via Bun.
- TypeScript declarations (`.d.ts` / `.d.cts`) via `tsc`.
- Scoped npm package: `@theogony/venus-core`.
- Sub-path exports: `.` (main), `./hono`, `./express`.
- Peer dependencies: `openai`, `zod`, `vectorjson` (required); `hono`, `express` (optional).
- Apache-2.0 license with SPDX headers on all source files.
- Prettier 3.x code formatting.
- `prepublishOnly` hook: `bun run lint && bun run build && bun test`.
