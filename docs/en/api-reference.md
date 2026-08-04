# API Reference

[English](./api-reference.md) | [中文](../zh-CN/api-reference.md)

[← Back to README](../../README.md)

## Core Engine

### `createVenusEngine(config: VenusEngineConfig): VenusEngine`

Factory function to create an engine instance.

### `engine.evaluate(imageUrl, genre?, context?): Promise<EvaluationResult>`

Run a full evaluation. Returns when all rounds complete.

| Parameter | Type | Description |
|-----------|------|-------------|
| `imageUrl` | `string` | URL of the image to evaluate |
| `genre` | `Genre` | Optional genre override; auto-detected if omitted |
| `context` | `EvaluationContext` | Optional context with EXIF data, user notes, and custom metadata |

Returns `EvaluationResult`:

```ts
type Suggestions = string[];

interface ArbitrationDecision {
  target: string;
  decision: 'accept' | 'partial' | 'reject' | 'consensus';
  reason: string;
}

interface ArbitrationNotes {
  sceneTypeRuling: string;
  decisions: ArbitrationDecision[];
  finalRationale: string;
}

interface EvaluationResult {
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
```

### `engine.evaluateStream(imageUrl, options?): AsyncGenerator<EvaluationStreamEvent>`

Streaming evaluation that yields events at each stage:

| Event Type | Description |
|------------|-------------|
| `evaluation_start` | Evaluation has begun |
| `genre_detected` | Genre auto-detection result (includes reasoning) |
| `agent_call` | An agent round is starting |
| `reasoning_chunk` | Real-time reasoning text (only in `updates` mode) |
| `result_chunk` | Incremental JSON partial (only in `updates` mode) |
| `agent_complete` | An agent round has finished (includes result + reasoning) |
| `evaluation_complete` | Final result available |
| `error` | An error occurred |

`EvaluateStreamOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `genre` | `Genre \| null` | — | Pre-specified genre (skips auto-detection) |
| `context` | `EvaluationContext` | — | Additional evaluation context |
| `mode` | `'values' \| 'updates'` | `'values'` | Streaming granularity mode |

**Mode comparison:**

| Mode | Behavior |
|------|----------|
| `values` | Emits milestone events only: `agent_call`, `agent_complete`, `evaluation_start`, `genre_detected`, `evaluation_complete`, `error` |
| `updates` | All of `values` plus real-time `reasoning_chunk` and `result_chunk` events for incremental UI updates |

## Group Evaluation

Group evaluation runs the same adversarial pipeline (genre detection → Proposer → Critic → optional Revision → Arbiter) over **2 to 10 images at once**. Every round receives the whole image set, so the agents judge the group as a group instead of aggregating independent single-image scores.

Two modes are available:

| Mode | Meaning | Output focus |
|------|---------|--------------|
| `joint` | Evaluate the images as one series/photo essay | Group-level `sceneType`, `totalScore`, genre `dimensions`, plus `groupAnalysis` on narrative and consistency |
| `compare` | Compare the images against each other | Full `ranking` (rank + score + rationale per image) plus `comparisonSummary` |

### `engine.evaluateGroup(imageUrls, mode, options?): Promise<GroupEvaluationResult>`

Run a full group evaluation. Returns when all rounds complete.

| Parameter | Type | Description |
|-----------|------|-------------|
| `imageUrls` | `string[]` | URLs of the images to evaluate — **2 to 10 entries**; outside that range throws `ValidationError` |
| `mode` | `'joint' \| 'compare'` | Group evaluation mode |
| `options` | `GroupEvaluateOptions` | Optional settings (see below) |

`GroupEvaluateOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `genre` | `Genre \| null` | — | Pre-specified genre for the whole group (skips auto-detection) |
| `context` | `EvaluationContext` | — | Additional evaluation context (EXIF data, user notes, custom metadata) |
| `includePerImage` | `boolean` | `false` | Whether to also request per-image details (`perImage`) |

**`includePerImage` and token cost**: the flag is enforced at **both the prompt and the JSON Schema layer**. When it is `false` (the default) the prompts do not ask for per-image output and the schema has no `per_image` field, so the model never generates those tokens — the saving is real, not a post-hoc filter. When it is `true` the schema adds a `per_image` array whose length must equal the image count, and each entry carries `index` / `score` / `comment`.

Returns `GroupEvaluationResult` — a discriminated union narrowed by `mode`:

```ts
// mode: 'joint'
interface GroupJointEvaluationResult {
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
  perImage?: PerImageDetail[];        // only when includePerImage: true
  process: {
    genreDetection?: AgentCallResult<{ genre: Genre; confidence: number }>;
    proposal: AgentCallResult<GroupJointProposerResult>;
    critique: AgentCallResult<CritiqueResult>;
    revision?: AgentCallResult<GroupJointProposerResult>;
    arbitration: AgentCallResult<GroupJointArbitrationResult>;
  };
  metadata: GroupEvaluationMetadata;
}

// mode: 'compare'
interface GroupCompareEvaluationResult {
  imageUrls: string[];
  mode: 'compare';
  genre: Genre;
  ranking: Array<{ index: number; rank: number; score: number; rationale: string }>;
  comparisonSummary: string;
  suggestions: Suggestions;
  arbitrationNotes: ArbitrationNotes;
  perImage?: PerImageDetail[];        // only when includePerImage: true
  process: { /* same shape, with GroupCompare* result types */ };
  metadata: GroupEvaluationMetadata;
}

interface GroupEvaluationMetadata {
  evaluatedAt: string;
  durationMs: number;
  rounds: 3 | 4;
  imageCount: number;
  includePerImage: boolean;
  context?: EvaluationContext;
}

interface PerImageDetail {
  index: number;    // position in the input imageUrls array (0-based)
  score: number;
  comment: string;
}
```

`index` in `ranking` and `perImage` always refers to the **0-based position in the input `imageUrls` array**, so results can be mapped back to the original order regardless of ranking.

### `engine.evaluateGroupStream(imageUrls, mode, options?): AsyncGenerator<GroupEvaluationStreamEvent>`

Streaming group evaluation. `GroupEvaluateStreamOptions` extends `GroupEvaluateOptions` with the streaming granularity:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `genre` | `Genre \| null` | — | Pre-specified genre (skips auto-detection) |
| `context` | `EvaluationContext` | — | Additional evaluation context |
| `includePerImage` | `boolean` | `false` | Whether to request per-image details |
| `mode` | `'values' \| 'updates'` | `'values'` | Streaming granularity mode (the group mode is the positional second argument, so the two never collide) |

| Event Type | Description |
|------------|-------------|
| `group_evaluation_start` | Group evaluation has begun (`{ imageUrls, mode, genre }`) |
| `genre_detected` | Genre auto-detection result for the whole group |
| `agent_call` | An agent round is starting |
| `reasoning_chunk` | Real-time reasoning text (only in `updates` mode) |
| `result_chunk` | Incremental JSON partial (only in `updates` mode) |
| `agent_complete` | An agent round has finished (includes result + reasoning) |
| `group_evaluation_complete` | Final `GroupEvaluationResult` available |
| `error` | An error occurred (also used for out-of-range image counts) |

Event order: round-0 `agent_call` / `agent_complete` + `genre_detected` (only when the genre is auto-detected) → `group_evaluation_start` → per-round `agent_call` / `agent_complete` → `group_evaluation_complete`. Failures — including an image count outside 2–10 — are reported as a final `error` event instead of a thrown exception.

```ts
for await (const event of engine.evaluateGroupStream(imageUrls, 'compare')) {
  if (event.type === 'group_evaluation_complete') {
    console.log(event.data.ranking);
  }
}
```

## Schema & Genre Utilities

### `GenreEnum`

Zod enum of all 8 photography genres:

```ts
import { GenreEnum } from '@theogony/venus-core';
// z.enum(['portrait','landscape','documentary','fine_art','commercial','architecture','nature','sports'])
```

### `ExifDataSchema` / `EvaluationContextSchema`

Zod schemas for `ExifData` and `EvaluationContext`, exported for consumer-side validation:

```ts
import { ExifDataSchema, EvaluationContextSchema } from '@theogony/venus-core';

const exif = ExifDataSchema.parse({ shutterSpeed: '1/2000', iso: 400 });
const ctx = EvaluationContextSchema.parse({ exif, userNotes: '...' });
```

### `getSchemas(genre: Genre)`

Returns `{ proposalSchema, critiqueSchema, arbiterSchema }` — Zod schemas for the given genre.

### `getGroupJointSchemas(genre, includePerImage, imageCount)`

Returns `{ proposalSchema, arbiterSchema }` — Zod schemas for `joint` group evaluation. The Critic round reuses the shared `critiqueSchema` from `getSchemas()`, so it is not part of the returned set.

| Parameter | Type | Description |
|-----------|------|-------------|
| `genre` | `Genre` | Genre driving the scene subtype enum and scoring dimensions |
| `includePerImage` | `boolean` | When `true`, the schema gains a `per_image` array; when `false` the field is absent entirely |
| `imageCount` | `number` | Number of images in the group — fixes the `per_image` array length and the valid `index` range |

```ts
import { getGroupJointSchemas } from '@theogony/venus-core';

const { proposalSchema, arbiterSchema } = getGroupJointSchemas('portrait', true, 3);
proposalSchema.parse({
  scene_type: 'wedding',
  total_score: 8.4,
  dimensions: { facial_expression: 8.5 /* ... */ },
  group_analysis: '...',
  critique: '...',
  suggestions: ['...'],
  per_image: [
    { index: 0, score: 8.2, comment: '...' },
    { index: 1, score: 8.6, comment: '...' },
    { index: 2, score: 8.4, comment: '...' },
  ],
});
```

### `getGroupCompareSchemas(imageCount, includePerImage)`

Returns `{ proposalSchema, arbiterSchema }` — Zod schemas for `compare` group evaluation. Note the **argument order differs from the joint variant**: `compare` output is genre-independent, so there is no `genre` parameter.

| Parameter | Type | Description |
|-----------|------|-------------|
| `imageCount` | `number` | Number of images in the group — fixes the `ranking` (and `per_image`) array length |
| `includePerImage` | `boolean` | When `true`, the schema gains a `per_image` array |

```ts
import { getGroupCompareSchemas } from '@theogony/venus-core';

const { proposalSchema } = getGroupCompareSchemas(3, false);
proposalSchema.parse({
  ranking: [
    { index: 0, rank: 2, score: 8.2, rationale: '...' },
    { index: 1, rank: 1, score: 8.8, rationale: '...' },
    { index: 2, rank: 3, score: 7.9, rationale: '...' },
  ],
  comparison_summary: '...',
  suggestions: ['...'],
});
```

Both factories cache their result per parameter combination, so repeated calls with the same arguments return the same schema instance. The `arbiterSchema` is the `proposalSchema` shape plus a required structured `arbitration_notes` object (`scene_type_ruling`, `decisions`, and `final_rationale`).

Validation rules enforced by both:

| Rule | Applies to |
|------|-----------|
| Array length must equal `imageCount` | `ranking`, `per_image` |
| `index` must be an integer in `0..imageCount - 1`, unique across entries | `ranking`, `per_image` |
| `rank` must be an integer forming a permutation of `1..imageCount` without duplicates | `ranking` |
| Text fields (`rationale`, `comment`, `comparison_summary`, `group_analysis`, `critique`) must be non-empty | both modes |
| `suggestions` must be an array of 1–8 non-empty single-line strings | both modes |
| `arbitration_notes` must contain a scene ruling, decision array, and final rationale | arbiter schemas |

### `getProposerResultSchema(genre: Genre)`

Returns the complete evaluation result Zod schema for the given genre, including all nested `process` and `metadata` fields. Useful for validating custom evaluation results or building custom adapters.

```ts
import { getProposerResultSchema } from '@theogony/venus-core';

const schema = getProposerResultSchema('portrait');
const validated = schema.parse({
  imageUrl: '...',
  genre: 'portrait',
  sceneType: 'studio',
  totalScore: 8.5,
  // ... full evaluation result structure
});
```

### `getGenreConfig(genre: Genre): GenreConfig`

Returns full configuration for a genre including labels, dimensions, and subtypes.

```ts
import { getGenreConfig } from '@theogony/venus-core';

const cfg = getGenreConfig('portrait');
console.log(cfg.label);             // '人像摄影'
console.log(cfg.dimensions);        // ['facial_expression', 'pose_body', ...]
console.log(cfg.dimensionLabels);   // ['神态', '姿态', ...]
console.log(cfg.subtypes);          // ['studio', 'environmental', 'wedding']
console.log(cfg.dimensionNames);    // { facial_expression: '面部神态', ... }
console.log(cfg.subtypeNames);      // { studio: '棚拍/写真', ... }
```

### `getMetadata(): Record<string, GenreMetadata>`

Returns metadata for all genres including labels, dimensions, and subtypes. Useful for building UIs.

```ts
import { getMetadata } from '@theogony/venus-core';

const metadata = getMetadata();
// { portrait: { label: '人像摄影', dimensions: [...], subtypes: [...] }, ... }
```

### `getAllGenres(): string[]`

Returns an array of all registered genre keys.

## Providers

### `createOpenAIChatProvider(options: OpenAIChatProviderOptions): LLMProvider`

Create a provider for any OpenAI-compatible Chat Completions API (OpenAI, DashScope, Together, vLLM, etc.). The endpoint behavior (reasoning parameter format) is auto-detected from the `baseURL` at construction time — no manual configuration needed.

```ts
import { createOpenAIChatProvider } from '@theogony/venus-core';

const provider = createOpenAIChatProvider({
  baseURL: 'https://api.together.xyz/v1',
  apiKey: process.env.TOGETHER_KEY!,
  defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
  timeout: 120_000,
  headers: { 'Custom-Header': 'value' },
  defaultExtra: { /* vendor-specific params */ },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseURL` | `string` | *required* | OpenAI-compatible API base URL |
| `apiKey` | `string` | *required* | API key |
| `defaultModel` | `string` | — | Default model identifier |
| `headers` | `Record<string, string>` | — | Extra HTTP headers |
| `timeout` | `number` | 60000 | Request timeout in milliseconds |
| `defaultExtra` | `Record<string, unknown>` | — | Vendor-specific extra parameters |
| `includeUsage` | `boolean` | `true` | Whether to request token usage in streaming mode via `stream_options.include_usage`. Set to `false` for endpoints that do not support this parameter. |

> **Note on structured output**: this provider declares `structuredOutput: 'json_object'`. Any
> `response_format` of type `json_schema` passed to it is **downgraded to `json_object`**
> (the schema is not sent to the endpoint) and a warning is logged. Schema enforcement is
> intentionally not applied for now; a future version may pass `json_schema` through for
> endpoints verified to support it. Use `createOpenAIResponsesProvider` if you need strict
> schema enforcement.

### `createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): LLMProvider`

Create a provider using the OpenAI Responses API (`/v1/responses`), for reasoning-capable models (o-series, GPT-5). Declares `structuredOutput: 'json_schema'` and honors strict JSON Schema output via `text.format`.

```ts
import { createOpenAIResponsesProvider } from '@theogony/venus-core';

const provider = createOpenAIResponsesProvider({
  baseURL: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_KEY!,
  defaultModel: 'gpt-5',
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseURL` | `string` | *required* | OpenAI API base URL |
| `apiKey` | `string` | *required* | API key |
| `defaultModel` | `string` | — | Default model identifier |
| `headers` | `Record<string, string>` | — | Extra HTTP headers |
| `timeout` | `number` | 60000 | Request timeout in milliseconds |
| `defaultExtra` | `Record<string, unknown>` | — | Provider-specific default extra parameters |
| `includeUsage` | `boolean` | `true` | Whether to request token usage in streaming mode |

### `createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider`

Create a provider for Anthropic's Claude models backed by the `@anthropic-ai/sdk` Messages API (`client.messages.create`). Declares `structuredOutput: 'json_schema'` and enforces strict JSON Schema output server-side via `output_config.format`.

The first system/developer message is lifted into the top-level `system` parameter (the Messages API has no `system` role); remaining turns map to `user`/`assistant`. Public image URLs are passed directly as `{ type: 'image', source: { type: 'url' } }` blocks (no client-side download); `data:` URLs become inline base64 image sources. Reasoning effort maps to extended thinking (`thinking: { type: 'enabled', budget_tokens }`, budget clamped to ≥ 1024 and derived from `budgetTokens` or the effort level); thinking blocks are surfaced as `reasoning` content and `usage.output_tokens_details.thinking_tokens` is reported as `reasoningTokens`. When thinking is enabled, `temperature` is omitted (the API requires it to be 1). The Messages API requires `max_tokens`; it is sourced from `extra.max_tokens`, then `defaultMaxTokens`, defaulting to 4096, and automatically raised above the thinking budget.

```ts
import { createAnthropicProvider } from '@theogony/venus-core';

const provider = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: 'claude-sonnet-4-5',
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *required* | Anthropic API key |
| `defaultModel` | `string` | — | Default model identifier |
| `baseURL` | `string` | `https://api.anthropic.com` | API base URL override |
| `timeout` | `number` | 60000 | Request timeout in milliseconds |
| `headers` | `Record<string, string>` | — | Extra HTTP headers |
| `defaultExtra` | `Record<string, unknown>` | — | Provider-specific default extra parameters |
| `defaultMaxTokens` | `number` | 4096 | Default `max_tokens` when not supplied via `extra.max_tokens` |

### `createGeminiProvider(options: GeminiProviderOptions): LLMProvider`

Create a provider for Google's Gemini models backed by the `@google/genai` Interactions API. Declares `structuredOutput: 'json_schema'` and enforces strict JSON Schema output via `response_format`. Requires Gemini 2.5+ / 3.x series models.

Public image URLs are passed to the API directly as `{ type: 'image', uri }` blocks (no client-side download); `data:` URLs are converted to inline base64 image blocks. Reasoning effort maps to `generation_config.thinking_level` (`none`/`minimal` → `minimal`, `high`/`max`/`xhigh` → `high`) with thought summaries surfaced as reasoning content; `budgetTokens` is not supported by the Interactions API and is ignored.

```ts
import { createGeminiProvider } from '@theogony/venus-core';

const provider = createGeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  defaultModel: 'gemini-3-flash-preview',
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *required* | Gemini API key |
| `defaultModel` | `string` | — | Default model identifier |
| `baseURL` | `string` | `https://generativelanguage.googleapis.com` | API base URL override |
| `timeout` | `number` | 60000 | Request timeout in milliseconds |
| `headers` | `Record<string, string>` | — | Extra HTTP headers |
| `defaultExtra` | `Record<string, unknown>` | — | Provider-specific default extra parameters |

### `defineProvider(options: DefineProviderOptions): LLMProvider`

Create a fully custom provider by implementing the `chat()` method directly.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | *required* | Provider name for logging |
| `capabilities` | `ProviderCapabilities` | — | Provider capability flags |
| `chat` | `(params: ChatParams) => Promise<ChatResponse>` | *required* | Chat completion implementation |
| `chatStream` | `(params: ChatParams) => AsyncIterable<StreamChunk>` | — | Optional streaming implementation |

`ProviderCapabilities`:

```ts
interface ProviderCapabilities {
  reasoning: boolean;       // Supports reasoning/thinking mode
  reasoningBudget: boolean; // Supports explicit token budget
  vision: boolean;          // Supports image inputs
  streaming: boolean;       // Supports streaming
  structuredOutput?: 'json_object' | 'json_schema'; // Structured output support (see below)
}
```

#### `structuredOutput` semantics

The `structuredOutput` capability controls how agents request and validate JSON output:

| Value | Agent behavior |
|-------|----------------|
| `'json_object'` or omitted | Requests `response_format: { type: 'json_object' }`. The agent parses JSON, validates it against the Zod schema, and retries up to `maxRetries` times with repair prompts. Failure after all attempts throws `SchemaError`. |
| `'json_schema'` | The agent builds a strict JSON Schema from the Zod schema and sends `response_format: { type: 'json_schema', ... }` in a **single call — no retries and no local Zod validation** (`maxRetries` does not apply). Schema compliance is trusted to the provider/API. If the response is not valid JSON, a `ProviderError` with `errorCode: 'parse_error'` is thrown immediately. |

> **Warning**: only declare `structuredOutput: 'json_schema'` on a custom provider if the
> underlying API actually guarantees schema-compliant output (e.g. OpenAI Responses API).
> Declaring it disables the agent-side validation/repair loop entirely.

Built-in provider support:

| Provider | `structuredOutput` | Notes |
|----------|--------------------|-------|
| `createOpenAIChatProvider` | `'json_object'` | `json_schema` response_format is downgraded to `json_object` with a warning |
| `createOpenAIResponsesProvider` | `'json_schema'` | Strict schema via `text.format`; the Xiaomi MiMo endpoint declares `'json_object'` (its `text.format` has no json_schema enforcement) |
| `createAnthropicProvider` | `'json_schema'` | Strict schema enforced server-side via `output_config.format`; on DashScope-compatible endpoints, unsupported schema keywords (e.g. `multipleOf`) are stripped client-side |
| `createGeminiProvider` | `'json_schema'` | Strict schema via `response_format` (Interactions API) |

#### Streaming JSON partials (`StreamChunk.partial`)

All built-in providers emit incremental JSON snapshots during `chatStream()` via the
`partial` field on `StreamChunk`:

- `content` — the raw text delta from the provider.
- `reasoning` — the reasoning/thinking text delta, if any.
- `partial` — an incremental JSON object parsed from the accumulated `content` stream.
  It is omitted whenever no parseable JSON value is available yet or parsing fails,
  so consumers must treat it as optional on every chunk.

`partial` powers the engine-level `result_chunk` events yielded by `evaluateStream()`
in `mode: 'updates'`, enabling incremental UI rendering of the evaluation JSON without
re-parsing the concatenated text yourself.

```ts
import { createVenusEngine, defineProvider, createOpenAIChatProvider } from '@theogony/venus-core';

const myProvider = defineProvider({
  name: 'my-llm',
  capabilities: {
    vision: true,
    reasoning: true,
    reasoningBudget: true,
  },
  async chat(params) {
    const res = await fetch('https://my-llm-api.com/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        reasoning: params.reasoning,  // Access reasoning params
      }),
    });
    const data = await res.json();
    return {
      content: data.text,
      reasoning: data.reasoning_content ?? null,
    };
  },
});

const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.API_KEY!,
  }),
  providers: {
    proposer: myProvider,
    critic: myProvider,
    // arbiter uses the default OpenAI Chat provider
  },
});
```

## Error Classes

All errors extend `VenusError` with a `code` property:

| Error Class | Code | Description |
|-------------|------|-------------|
| `VenusError` | `VENUS_ERROR` | Base error class |
| `ValidationError` | `VALIDATION_ERROR` | Invalid input (bad URL, unknown genre) |
| `ProviderError` | `PROVIDER_ERROR` | LLM provider failure |
| `SchemaError` | `SCHEMA_ERROR` | Agent output failed schema validation |
| `TimeoutError` | `TIMEOUT_ERROR` | Evaluation timed out |

`ProviderError` includes additional fields for fine-grained diagnosis:
- `provider: string` — Name of the failing provider
- `errorCode: ProviderErrorCode` — One of `'network' | 'api_error' | 'parse_error' | 'timeout' | 'auth_error' | 'unknown'`
- `statusCode?: number` — HTTP status code if applicable

Errors thrown by the built-in LLM SDKs (OpenAI Chat Completions, OpenAI Responses,
Anthropic Messages API, and Google GenAI) are classified centrally and consistently by
the provider layer — for both `chat()` and the initial request phase of `chatStream()`:
HTTP 401/403 → `auth_error`, connection timeouts → `timeout`, DNS/connection failures →
`network`, other HTTP ≥ 400 → `api_error`, anything else → `unknown`.

```ts
import { ProviderError, ValidationError } from '@theogony/venus-core';

try {
  const result = await engine.evaluate(imageUrl);
} catch (err) {
  if (err instanceof ProviderError) {
    console.error(`Provider ${err.provider} failed: [${err.errorCode}] ${err.message}`);
  } else if (err instanceof ValidationError) {
    console.error(`Invalid input: ${err.message}`);
  }
}
```

## Type Exports

All public types are re-exported for consumer use:

```ts
import type {
  // Core types
  Genre,
  GenreConfig,
  GenreMetadata,
  SubtypeForGenre,
  DimensionForGenre,
  ExifData,
  EvaluationContext,
  EvaluationResult,
  EvaluationStreamEvent,
  EvaluateStreamOptions,
  StreamMode,

  // Group evaluation types
  GroupEvaluationMode,
  GroupEvaluateOptions,
  GroupEvaluateStreamOptions,
  GroupEvaluationResult,
  GroupJointEvaluationResult,
  GroupCompareEvaluationResult,
  GroupEvaluationMetadata,
  GroupEvaluationStreamEvent,
  GroupJointProposerResult,
  GroupCompareProposerResult,
  GroupJointArbitrationResult,
  GroupCompareArbitrationResult,
  PerImageDetail,
  
  // Provider types
  LLMProvider,
  ProviderCapabilities,
  ChatParams,
  ChatResponse,
  ChatMessage,
  ChatContentPart,
  StreamChunk,
  TokenUsage,
  ReasoningEffort,
  ReasoningConfig,
  AgentReasoningConfig,
  ChatReasoningParams,
  OpenAIChatProviderOptions,
  OpenAIResponsesProviderOptions,
  AnthropicProviderOptions,
  GeminiProviderOptions,
  DefineProviderOptions,
  
  // Engine & Agent types
  VenusEngineConfig,
  AgentRole,
  AgentConfig,
  AgentCallResult,
  ModelConfig,
  ProviderConfig,
  
  // Result types
  ProposerResult,
  ArbitrationResult,
  CritiqueResult,
  CritiqueChallenge,
  SceneTypeReview,
  
  // Error types
  ProviderErrorCode,
  VenusError,
  ValidationError,
  ProviderError,
  SchemaError,
  TimeoutError,
  
  // Adapter types
  AdapterOptions,
  AdapterHooks,
  EvaluateParams,
  GroupEvaluateParams,
  GroupEvaluateRequestBody,
  MetadataResponse,
} from '@theogony/venus-core';
```

## See Also

- [Usage Guide](./usage-guide.md) — End-to-end code examples for streaming, web frameworks, hooks, and context extension
- [Configuration](./configuration.md) — `VenusEngineConfig` full reference and reasoning configuration
