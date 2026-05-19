# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
