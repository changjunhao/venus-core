# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.13.0] - 2026-08-01

### Added

- **Group evaluation**: new `engine.evaluateGroup(imageUrls, mode, options?)` and
  `engine.evaluateGroupStream(imageUrls, mode, options?)` run the same
  adversarial pipeline (genre detection → Proposer → Critic → conditional
  Revision → Arbiter) over 2 to 10 images at once, passing the whole image set
  into every round so the agents judge the group as a group instead of
  aggregating independent single-image scores. Two modes are supported:
  `joint` evaluates the images as one series (group-level `sceneType`,
  `totalScore`, genre `dimensions` and `groupAnalysis`), while `compare` ranks
  the images against each other (`ranking` with rank / score / rationale per
  image, plus `comparisonSummary`). Image counts outside 2–10 raise
  `ValidationError` (surfaced as a terminal `error` event when streaming).
- **`includePerImage` option**: opt-in per-image details (`perImage`) for both
  group modes, enforced at the prompt *and* JSON Schema layer — when disabled
  (the default) the schema has no `per_image` field at all, so those tokens are
  never generated rather than filtered after the fact.
- **Group schema factories**: `getGroupJointSchemas(genre, includePerImage, imageCount)`
  and `getGroupCompareSchemas(imageCount, includePerImage)` are exported for
  consumer-side validation and custom adapters, both cached per parameter
  combination. `ranking` and `per_image` are validated as fixed-length arrays
  with unique indices, and `rank` values must form a permutation of
  `1..imageCount`.
- **Group adapter endpoints**: Hono and Express adapters expose
  `POST /evaluate/group`, `POST /evaluate/group/stream` (SSE) and
  `POST /evaluate/group/stream/jsonl` (JSON Lines), sharing one
  `groupEvaluateRequestSchema` validation path, plus a new
  `beforeEvaluateGroup` lifecycle hook that can rewrite every field of
  `GroupEvaluateParams` on all three endpoints.
- **Group streaming events**: `group_evaluation_start` and
  `group_evaluation_complete` event types alongside the existing `agent_call`,
  `agent_complete`, `genre_detected`, `reasoning_chunk`, `result_chunk` and
  `error` events.

## [0.12.0] - 2026-07-29

### Added

- **Anthropic provider implemented**: `createAnthropicProvider` is no longer an
  experimental skeleton — full `messages.create` support with non-streaming and
  streaming modes, strict `json_schema` structured output via `output_config`,
  image URL / data-URL blocks, and extended thinking mapped from reasoning
  effort with thinking blocks surfaced as reasoning content.
- **Gemini provider implemented**: `createGeminiProvider` is no longer an
  experimental skeleton — full `interactions.create` support with non-streaming
  and streaming modes, strict `json_schema` structured output, image URL /
  data-URL blocks, and `thinking_level` mapping with thought summaries surfaced
  as reasoning content.
- **Volcano Ark (Doubao) Responses API support**: new
  `adaptResponsesReasoningParams` maps reasoning to Ark's `thinking.type` +
  nested `reasoning.effort` shape (`minimal`/`none` → disabled, `max` → `xhigh`,
  `summary` never sent); other endpoints keep the OpenAI shape.
  `createOpenAIResponsesProvider` detects endpoint behavior from `baseURL`,
  keeps `temperature` for Ark alongside reasoning, and extracts raw
  chain-of-thought from `reasoning_text` content items in addition to summaries.
  `adaptReasoningParams` explicitly disables thinking for Ark when reasoning is
  not configured (Ark defaults to enabled).
- **Xiaomi MiMo Responses API support**: nested `reasoning.effort` only, with
  explicit `effort: 'none'` to disable (`minimal`→`none`, `max`/`xhigh`→`high`,
  `summary` never sent); `temperature` is always skipped (managed internally by
  the model); `json_schema` is downgraded to `json_object` with a warning and
  the `structuredOutput` capability reports accordingly; streaming handles
  `response.reasoning_text.delta` events (raw chain-of-thought).
- **`CallConfig.provider` per-call provider override**: `providers.revision` in
  `VenusEngineConfig` now actually routes the revision round to its own
  provider. When not configured, the revision round keeps using the proposer's
  provider (unchanged behavior).
- **Anthropic-compatible endpoint support (DashScope / Zhipu)**:
  `createAnthropicProvider` now auto-detects endpoint behavior from `baseURL`
  (e.g. `https://dashscope.aliyuncs.com/apps/anthropic`,
  `https://open.bigmodel.cn/api/anthropic`); the official Anthropic request path
  stays byte-for-byte unchanged. Models on both endpoints may default to
  thinking enabled, so `thinking: { type: 'disabled' }` is sent explicitly when
  reasoning is not configured, with `temperature` still forwarded. Structured
  output keeps strict `json_schema` via `output_config.format` (qwen series
  guarantees valid JSON server-side; deepseek/glm series enforce the schema
  strictly). Endpoint-specific handling:
  - Zhipu: `thinking: { type: 'enabled' }` is sent without `budget_tokens`
    (GLM has no tunable thinking budget) while `max_tokens` still grows by the
    resolved budget.
  - DashScope: JSON Schema keywords rejected by DashScope's validator (e.g.
    `multipleOf`) are stripped client-side via `sanitizeDashScopeSchema` before
    sending.
- Endpoint host table now recognizes `dashscope-us.aliyuncs.com` and
  workspace-dedicated `{WorkspaceId}.<region>.maas.aliyuncs.com` domains as
  `dashscope` behavior.

### Changed

- **`@anthropic-ai/sdk` and `@google/genai` moved from optional peer
  dependencies to regular dependencies**, now that the Anthropic and Gemini
  providers are fully implemented. Installing `@theogony/venus-core` pulls both
  SDKs in automatically; remove any manual peer installs.
- **Unified provider error classification**: the shared classifier
  (`classifyProviderError`, moved out of `providers/openai-errors.ts`) is now
  applied by all built-in providers — OpenAI Chat / Responses, Anthropic, and
  Gemini.
- **`chatStream()` initial request error classification** (behavior change):
  initial request failures (network / timeout / auth) are now classified via
  `ProviderError.errorCode` the same way as `chat()` — HTTP 401/403 →
  `auth_error`, timeouts → `timeout`, DNS/connection failures → `network`,
  other HTTP ≥ 400 → `api_error`, anything else → `unknown`. Previously these
  always surfaced as `errorCode: 'api_error'` with a `Stream call failed:`
  message prefix (now `LLM call failed:`, consistent with `chat()`). Do not
  rely on the old prefix or the uniform `api_error` code; mid-stream failures
  keep the `Stream call failed:` prefix with `api_error`.

### Fixed

- **`evaluateStream()` now fires `onEvent`**: the streaming evaluation path
  emits the same observability events as `evaluate()` (`round_start`,
  `agent_call`, `agent_complete`, `round_complete`, `error`) alongside the
  yielded `EvaluationStreamEvent` stream. Previously `onEvent` was only
  invoked by the non-streaming path. Listener exceptions never break the
  evaluation pipeline.
- The incremental JSON parser backing `result_chunk` events is now always
  released on mid-stream errors and early stream termination.

### Security

- **Prompt-injection hardening for caller-supplied context** (CWE-77):
  `userNotes`, `custom` metadata, and EXIF string fields are sanitized before
  prompt injection — control characters stripped, lengths capped, and user
  content wrapped in `<user_notes>` / `<custom_metadata>` tags preceded by an
  untrusted-data notice instructing the model to ignore any embedded
  instructions.
- **SSRF guard on `imageUrl`** (CWE-918): adapter request validation now
  rejects `http`/`https` URLs targeting private or reserved hosts (loopback,
  RFC 1918, link-local, cloud metadata, IPv6 ULA). Vendor-specific schemes
  (`data:`, `oss:`, `gs:`, `cos:`, …) pass through untouched. Local
  development setups serving images from `localhost` must now use a
  publicly-resolvable host or a non-HTTP scheme.

## [0.11.0] - 2026-07-28

### Added

- **OpenAI Responses provider implemented**: `createOpenAIResponsesProvider` is no
  longer an experimental skeleton — full `/v1/responses` support with non-streaming
  and SSE streaming modes, reasoning summary extraction, input/output token usage,
  message-to-input conversion with vision support, and strict `json_schema`
  structured output via `text.format`.
- **Structured output capability declaration**: new
  `ProviderCapabilities.structuredOutput` field (`'json_object' | 'json_schema'`)
  and a `json_schema` variant added to the `ResponseFormat` union.
  - `BaseAgent` uses a single call with a strict JSON Schema built from Zod for
    `json_schema`-capable providers (no retries / local validation — trusted to
    the API), while `json_object` providers keep the Zod validation +
    repair-retry loop. Warns when the declared schema guarantee is not honored.
- **Generated endpoint host table**: new dev-time codegen script
  (`scripts/generate-endpoint-hosts.ts`) fetches the models.dev catalog and emits
  `src/providers/endpoint-hosts.ts` (committed — build/test/publish never require
  network). `detectEndpointBehavior` now matches against the generated
  `ENDPOINT_HOSTS` table with first-match-wins and `'openai'` fallback; the
  `EndpointBehavior` type is exported.

### Fixed

- Endpoint hosts previously falling back to `'openai'` behavior are now detected
  correctly: `dashscope-intl.aliyuncs.com`, `token-plan.*.maas.aliyuncs.com`,
  `api.moonshot.ai`, `api.kimi.com`, `api.stepfun.ai`.

### Changed

- **openai-chat `json_schema` downgrade**: `createOpenAIChatProvider` downgrades a
  `json_schema` response format to `json_object` with a warning log (schema
  pass-through for verified endpoints may come in a future version).
- Shared OpenAI error classification extracted into
  `providers/openai-errors.ts` (`classifyOpenAIError`), reused by both
  openai-chat and openai-responses providers.
- Dependency bumps: `openai` ^7.0.0, `hono` ^4.12.32, `@anthropic-ai/sdk`
  ^0.115.0, `@google/genai` ^2.13.0, plus dev tooling updates.
- Node.js requirement raised to `>=22.0.0`.

## [0.10.0] - 2026-06-20

### Added

- **Gemini OpenAI-compatible endpoint support**: `detectEndpointBehavior` now recognizes
  `generativelanguage.googleapis.com` base URLs and auto-adapts reasoning to
  `reasoning_effort` (same format as OpenAI, internally mapped to thinking_level /
  thinking_budget by Gemini API). Temperature is skipped when reasoning is enabled
  (Gemini reasoning models ignore temperature, consistent with OpenAI/DeepSeek).
- **Grok (xAI) OpenAI-compatible support**: `detectEndpointBehavior` now recognizes
  `api.x.ai` base URLs, mapping 5-level reasoning effort to Grok's 4-level format
  (`none` / `low` / `medium` / `high`; `minimal`→`none`, `max`→`high`). Explicitly
  disables reasoning with `reasoning_effort='none'` when not configured (Grok defaults
  to `low`). Extracts `reasoning_tokens` from `prompt_tokens_details` (xAI Responses
  API style).
- **`ReasoningConfig.enabled` global toggle**: Add optional `enabled?: boolean` field
  providing a clear global kill switch for reasoning across all agents. When set to
  `false`, reasoning is disabled for every agent regardless of `effort` or per-agent
  overrides. Fully backward compatible when omitted.

### Fixed

- **OpenAI Chat Completions API compatibility**:
  - DeepSeek reasoning: move `thinking` to top-level request body field instead of
    invalid `extra_body` wrapper (SDK method param, not API request field).
  - Add `developer` role to `ChatMessage` for o1/o3/o4-mini reasoning models.
  - Add `detail` option to `image_url` content part (`auto` / `low` / `high`).
  - Enable `stream_options.include_usage` in streaming mode to capture token usage
    from the final chunk; add `usage` field to `StreamChunk`.
  - Add configurable `includeUsage` option (default: `true`) to
    `OpenAIChatProviderOptions` for endpoints that don't support `stream_options`.

### Changed

- **Reasoning parameter adaptation consolidated**: `adaptReasoningParams()` is now the
  single source of truth for both enabling and disabling reasoning. When reasoning is
  undefined, returns endpoint-specific disable fields for dashscope/qianfan
  (`enable_thinking: false`), kimi/mimo/zhipu/minimax (`thinking: { type: 'disabled' }`),
  and grok (`reasoning_effort: 'none'`), ensuring predictable behavior regardless of
  model defaults.

## [0.9.0] - 2026-06-02

### Added

- **Zhipu (BigModel) endpoint auto-detection**: `detectEndpointBehavior` now recognizes
  `bigmodel.cn` / `open.bigmodel.cn` base URLs and auto-adapts reasoning parameters to
  Zhipu's `thinking: { type: "enabled" }` format. Explicitly disables thinking when
  reasoning is not configured (GLM thinking models like `glm-5.1` default to enabled).
- **MiniMax OpenAI-compatible API support**: detect `api.minimaxi.com` / `api.minimax.io`
  endpoints, adapt reasoning to MiniMax's `thinking: { type: "adaptive" }` with
  `reasoning_split: true`, and extract reasoning from `reasoning_details` array in both
  streaming and non-streaming modes.
- **Baidu Qianfan (ERNIE) endpoint support**: `detectEndpointBehavior` now recognizes
  `qianfan.baidubce.com` base URLs, adapting reasoning with `enable_thinking: true`
  (ERNIE does not support `thinking_budget`).
- **StepFun API compatibility**: add `stepfun.com` endpoint detection and
  `reasoning_effort` parameter mapping (5-level → 3-level: `minimal`→`low`, `max`→`high`).
  StepFun is fully OpenAI-compatible with baseURL `https://api.stepfun.com/v1`.
- Documentation updated in README (EN/ZH) and configuration guides (EN/ZH) listing
  reasoning parameter formats for StepFun, MiniMax, and Baidu Qianfan.

## [0.8.2] - 2026-05-30

### Fixed

- Update JSDoc examples in Hono and Express adapters to use `provider`-based engine config (not the removed `baseURL`/`apiKey` pattern).

## [0.8.1] - 2026-05-30

### Fixed

- Add `@module` JSDoc tags to Hono and Express adapter entrypoints for JSR score compliance.

## [0.8.0] - 2026-05-30

### Added

- **Xiaomi MIMO endpoint support**: `detectEndpointBehavior` now recognizes
  `api.xiaomimimo.com` base URLs as `'mimo'` behavior, auto-adapting reasoning
  parameters to MIMO's `thinking: { type: "enabled" }` format (same as Kimi).

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
