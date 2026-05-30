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
interface EvaluationResult {
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

### `createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): LLMProvider`

Create a provider using the OpenAI Responses API. See source for full options.

### `createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider`

Create a provider for Anthropic's Claude models via the Messages API.

### `createGeminiProvider(options: GeminiProviderOptions): LLMProvider`

Create a provider for Google's Gemini models via the Generative Language API.

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
}
```

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
  MetadataResponse,
} from '@theogony/venus-core';
```

## See Also

- [Usage Guide](./usage-guide.md) — End-to-end code examples for streaming, web frameworks, hooks, and context extension
- [Configuration](./configuration.md) — `VenusEngineConfig` full reference and reasoning configuration
