# Configuration Reference

[English](./configuration.md) | [中文](../zh-CN/configuration.md)

[← Back to README](../../README.md)

## VenusEngineConfig

`VenusEngineConfig` full reference:

| Option         | Type                               | Default    | Description                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider`     | `LLMProvider`                      | _required_ | LLM provider instance (use `createOpenAIChatProvider` or `defineProvider`)                                                                                                                                                                                   |
| `defaultModel` | `string`                           | —          | Default model for all agents (recommended)                                                                                                                                                                                                                   |
| `models`       | `ModelConfig`                      | —          | Per-agent model overrides (`genreDetector`, `proposer`, `critic`, `arbiter`, `revision`)                                                                                                                                                                     |
| `providers`    | `ProviderConfig`                   | —          | Per-agent custom provider instances, falls back to `provider` if not set (`revision` falls back to the proposer's provider)                                                                                                                                  |
| `reasoning`    | `ReasoningConfig`                  | —          | Reasoning config with global `enabled`/`effort`/`budgetTokens` and per-agent `agents` overrides                                                                                                                                                              |
| `maxRetries`   | `number`                           | `3`        | Total agent attempt limit, including the first call, in `json_object` mode. `1` means one attempt without repair; `json_schema` always uses one agent attempt with local Zod validation (see [API Reference](./api-reference.md#structuredoutput-semantics)) |
| `onEvent`      | `(event: EvaluationEvent) => void` | —          | Event callback for observability                                                                                                                                                                                                                             |

### Model Resolution

Set `defaultModel` on the engine or provide `models` entries for the roles it initializes. The engine does not read a provider's `defaultModel`; missing model configuration raises `VenusError` with `code: 'CONFIG_ERROR'` when that role is resolved. Use a vision-capable model for image evaluation.

Configuration is supplied as objects. Loading environment variables and keeping API keys on the server are the caller's responsibility.

### Event System and Streaming

`onEvent` observes `evaluate()`, `evaluateStream()`, `evaluateGroup()`, and `evaluateGroupStream()`. Pipeline events include `round_start`, `agent_call`, `agent_complete`, `round_complete`, `error`, and `cancelled`, each with a `timestamp`. Stream iterators separately yield single-image or group stream events, so observability does not require parsing SSE/JSONL.

`cancelled` is an observation event only: it is emitted at most once for an active evaluation, not for a pre-aborted request or a hook cancelled before the engine starts. Cancellation does not emit an `error` observation or a completion frame.

## Reasoning Configuration

```ts
interface ReasoningConfig {
  /** Whether reasoning is enabled globally (default: true when this object is present). Set to `false` to disable reasoning for all agents. */
  enabled?: boolean;
  /** Default reasoning effort applied to all agents (when set) */
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
  /** Default token budget for reasoning */
  budgetTokens?: number;
  /** Per-agent overrides; set to `false` to disable reasoning for a specific agent */
  agents?: Partial<
    Record<
      AgentRole,
      | {
          effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'; // Required
          budgetTokens?: number;
        }
      | false
    >
  >;
}
```

Example with full configuration:

```ts
const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  defaultModel: '<your-model>',
  reasoning: {
    effort: 'medium',
    budgetTokens: 4096,
    agents: {
      proposer: { effort: 'medium', budgetTokens: 4096 },
      critic: { effort: 'medium', budgetTokens: 4096 },
      arbiter: { effort: 'high', budgetTokens: 8192 },
      genreDetector: false, // Disable reasoning for genre detector
    },
  },
  onEvent(event) {
    console.log(`[${event.type}] round=${event.round} agent=${event.agent}`);
  },
});
```

The engine automatically adapts reasoning parameters to different provider APIs:

- **OpenAI**: Chat Completions uses `reasoning_effort`; Responses uses `reasoning: { effort }`. The public `ReasoningEffort` union is `none/minimal/low/medium/high/max/xhigh`; supported values depend on the selected model
- **Qwen (DashScope)**: Uses `enable_thinking` and `thinking_budget`
- **Kimi (Moonshot)**: Uses `thinking: { type: "enabled" }`
- **Xiaomi MiMo**: Chat Completions uses `thinking: { type: "enabled" }` (same format as Kimi); the Responses API endpoint (`https://api.xiaomimimo.com/v1` via `createOpenAIResponsesProvider`) uses nested `reasoning: { effort }` only (`none` disables thinking, minimal→none, max/xhigh→high; `reasoning.summary` is never sent and temperature is managed internally by the model)
- **Zhipu (BigModel)**: Uses `thinking: { type: "enabled" }` (same format as Kimi); the Anthropic-compatible endpoint (`https://open.bigmodel.cn/api/anthropic` via `createAnthropicProvider`) is auto-detected as well, and `budget_tokens` is never sent when thinking is enabled (GLM has no tunable thinking budget)
- **StepFun**: Uses `reasoning_effort: "low" | "medium" | "high"` (5-level mapped to 3-level: minimal→low, max→high)
- **MiniMax**: Uses `thinking: { type: "adaptive" }` with `reasoning_split: true`
- **Doubao (Volcano Ark)**: Chat Completions uses `thinking.type` toggle + `reasoning_effort`; the Responses API endpoint (`https://ark.cn-beijing.volces.com/api/v3` via `createOpenAIResponsesProvider`) uses `thinking.type` + nested `reasoning: { effort }` (minimal→thinking disabled, xhigh→max; `reasoning.summary` is never sent)
- **Baidu Qianfan (ERNIE)**: Uses `enable_thinking: true`
- **Grok (xAI)**: Uses `reasoning_effort` (none/low/medium/high; 5-level mapped: minimal→none, max→high)
- **Gemini**: OpenAI-compatible endpoint uses `reasoning_effort` (same as OpenAI, internally mapped to thinking_level/thinking_budget); the native `createGeminiProvider` (Interactions API) maps effort directly to `generation_config.thinking_level` (none/minimal→minimal, high/max/xhigh→high) with `thinking_summaries: "auto"`
- **DeepSeek**: Chat Completions uses the `thinking.type` toggle + `reasoning_effort` (only low/high/max supported; client-side mapping: none/minimal→thinking disabled, medium/xhigh→high); the Responses API endpoint (`https://api.deepseek.com` via `createOpenAIResponsesProvider`) uses nested `reasoning: { effort }` (none/low/high/max; `none` disables thinking, `reasoning.summary` is never sent). DeepSeek v4 models (including the vision model `deepseek-v4-flash-vision-exp`) default to thinking enabled — an explicit disable parameter is sent when reasoning is not configured
- **OpenRouter**: Uses `reasoning: { effort, max_tokens, enabled: true }`

> **Note**: When reasoning is not configured, the provider explicitly disables thinking for endpoints whose models default to enabled (DashScope, Qianfan, Kimi, MIMO, Zhipu, MiniMax, Volcano Ark, Grok, DeepSeek), ensuring predictable behavior.

### Doubao (Volcano Ark) Responses API

The Responses provider works with Volcano Ark's Doubao models out of the box — endpoint behavior is auto-detected from `baseURL`:

```ts
const provider = createOpenAIResponsesProvider({
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: process.env.ARK_API_KEY!,
});
```

Ark-specific optional parameters (e.g. `caching`, `service_tier`, `expire_at`) can be passed through via `defaultExtra` (per-provider) or `extra` (per-call). Note that `text.format` structured output (`json_schema`/`json_object`) is currently in beta on Volcano Ark.

### Xiaomi MiMo Responses API

The Responses provider also works with Xiaomi MiMo models (e.g. `mimo-v2.5-pro`) out of the box — endpoint behavior is auto-detected from `baseURL`:

```ts
const provider = createOpenAIResponsesProvider({
  baseURL: 'https://api.xiaomimimo.com/v1',
  apiKey: process.env.MIMO_API_KEY!,
});
```

MiMo specifics handled automatically:

- Thinking is controlled via nested `reasoning: { effort }` (`none`/`low`/`medium`/`high`); `effort: 'none'` is always sent explicitly when reasoning is not configured, so the model never falls back to its thinking-enabled default
- `temperature` is never sent (MiMo manages it internally), and `reasoning.summary` is never sent (not a documented request parameter)
- Structured output only supports `json_object` — `json_schema` response formats are automatically degraded to `json_object` with a warning (schema enforcement falls back to the engine-side validation)
- Streaming reasoning arrives via `response.reasoning_text.delta` events and is surfaced as regular `reasoning` chunks

MiMo also accepts the `api-key` header as an alternative to `Authorization: Bearer`; the SDK's default Bearer auth works as-is, but you can switch via the `headers` option if needed.

### DeepSeek Vision Model (deepseek-v4-flash-vision-exp)

DeepSeek's vision model `deepseek-v4-flash-vision-exp` works over both the Chat Completions and the Responses API paths — endpoint behavior is auto-detected from `baseURL`.

**Responses API**:

```ts
const provider = createOpenAIResponsesProvider({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  defaultModel: 'deepseek-v4-flash-vision-exp',
});
```

**Chat Completions**:

```ts
const provider = createOpenAIChatProvider({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  defaultModel: 'deepseek-v4-flash-vision-exp',
});
```

DeepSeek specifics handled automatically:

- **Structured output uniformly uses `json_object` + engine-side retries**: although the DeepSeek Responses API docs claim full `text.format` support, in practice `deepseek-v4-flash-vision-exp` does not reliably enforce `json_schema` constraints (responses may omit required fields), so `json_schema` is automatically degraded to `json_object` with a warning on both paths; engine-side Zod validation + automatic repair retries cover the gap (and DeepSeek JSON Output's probabilistic empty `content` responses)
- **Thinking is enabled by default**: DeepSeek v4 models think at effort=high unless told otherwise. When reasoning is not configured, Chat Completions explicitly sends `thinking: { type: 'disabled' }` and the Responses API explicitly sends `reasoning: { effort: 'none' }`, keeping standard mode predictable and free of extra thinking tokens. To enable thinking, configure `reasoning` explicitly (client-side effort mapping: none/minimal→thinking disabled, medium/xhigh→high, low/high/max passed through)
- `reasoning.summary` is never sent on the Responses API (DeepSeek accepts it but does not generate summaries); `temperature` has no effect in thinking mode (without erroring) and is omitted when reasoning is configured
- Images are passed as standard `image_url` blocks (allowed in user messages only — the engine satisfies this by construction), supporting base64 data URLs and external http(s) URLs. Prefer URLs: the multi-agent pipeline resends images on every round, and URLs let DeepSeek fetch server-side instead of re-uploading base64 repeatedly. Note that each image's token consumption is capped (~384 tokens; DeepSeek auto-rescales images to ~800×800 equivalent pixels)

DeepSeek image limits: 48 MiB request body, ≤32 MiB per image (base64/URL), JPEG/PNG/GIF/WebP formats, external URLs ≤8192 characters and downloadable within 60 seconds.

### Alibaba Cloud Model Studio (DashScope) Anthropic-Compatible Endpoint

The Anthropic provider works with Alibaba Cloud Model Studio's Anthropic-compatible Messages API out of the box — endpoint behavior is auto-detected from `baseURL`:

```ts
const provider = createAnthropicProvider({
  baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  defaultModel: 'qwen3.7-plus',
});
```

Set `baseURL` up to `/apps/anthropic` (do not end with `/v1/`). Besides the Beijing region, Singapore (`dashscope-intl.aliyuncs.com`), US (`dashscope-us.aliyuncs.com`), and workspace-dedicated domains (`https://{WorkspaceId}.<region>.maas.aliyuncs.com/apps/anthropic`) are supported.

DashScope specifics handled automatically:

- `thinking: { type: 'disabled' }` is sent explicitly when reasoning is not configured (some qwen models default to thinking enabled), with `temperature` forwarded as usual; when reasoning is configured the behavior matches the official API (`thinking: { type: 'enabled', budget_tokens }`, `temperature` omitted)
- Structured output keeps the strict `json_schema` strategy via `output_config.format` — the provider reports `structuredOutput: 'json_schema'` (one agent attempt with local Zod validation, no agent-level repair). JSON Schema keywords rejected by DashScope's validator (e.g. `multipleOf`) are stripped client-side before sending. Note the enforcement level depends on the model series: deepseek/glm enforce the schema strictly, while the qwen series only guarantees valid JSON output
- Authentication uses the SDK's default `x-api-key` header (pass your Model Studio API key); streaming events match the official Messages API

### Zhipu (BigModel) Anthropic-Compatible Endpoint

The Anthropic provider also works with Zhipu's Claude-compatible API out of the box — endpoint behavior is auto-detected from `baseURL`:

```ts
const provider = createAnthropicProvider({
  baseURL: 'https://open.bigmodel.cn/api/anthropic',
  apiKey: process.env.ZHIPU_API_KEY!,
  defaultModel: 'glm-4.6',
});
```

Set `baseURL` up to `/api/anthropic` (do not end with `/v1/`).

Zhipu specifics handled automatically:

- `thinking: { type: 'disabled' }` is sent explicitly when reasoning is not configured (GLM models default to thinking enabled, some even force it), with `temperature` forwarded as usual; when reasoning is configured, `thinking: { type: 'enabled' }` is sent without `budget_tokens` (GLM has no tunable thinking budget, `temperature` omitted), and `max_tokens` still grows by the effort's budget to leave room for thinking
- Structured output keeps the strict `json_schema` strategy via `output_config.format`, enforced server-side by the GLM series — the provider reports `structuredOutput: 'json_schema'` (one agent attempt with local Zod validation, no agent-level repair)
- Authentication uses the SDK's default `x-api-key` header (pass your Zhipu API key); streaming events match the official Messages API

## Cancellation and Timeouts

Cancellation, transport deadlines, and agent attempts are separate controls:

| Control                   | Where to configure                                                                   | Scope and outcome                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `signal`                  | Fourth argument to `evaluate()`; options object for the other three methods          | Cancels the whole evaluation, including later rounds; rejects with `AbortError` (`ABORTED`)                      |
| `AbortSignal.timeout(ms)` | Pass the returned signal at the same request-level location                          | An overall deadline reported as `AbortError`; the original DOM `TimeoutError` remains in `reason`/`cause`        |
| Provider `timeout`        | Options for OpenAI Chat, OpenAI Responses, Anthropic, or Gemini; default `60_000` ms | Transport timeout, classified as `ProviderError` with `errorCode: 'timeout'`; not an overall evaluation deadline |
| `maxRetries`              | `VenusEngineConfig` (or `AgentConfig` for an agent instance)                         | Total `json_object` agent attempt limit, default `3`; independent of provider/SDK transport retries              |

`signal` is not a field on `VenusEngineConfig`, provider constructor options, `EvaluationContext`, or the HTTP JSON body. Adapters derive it from Web request/stream cancellation or Node connection events and supply it to hooks as the second argument. See the [API reference](./api-reference.md#end-to-end-cancellation).

### Agent Attempts

- `json_schema`: one agent attempt followed by local Zod validation; no agent-level repair. Provider transport retries may still occur.
- `json_object`: at most `maxRetries` total attempts. Non-streaming calls retry provider, JSON parsing, and validation failures; streaming calls retry completed-output parsing/validation failures, but transport failures propagate immediately.
- Cancellation never enters the retry loop or becomes `SchemaError`. Other `json_object` failures that exhaust the attempt limit become `SchemaError`, so a provider timeout may not remain a `ProviderError` at the engine boundary.

### Gemini Transport Retry

The provider manages Interactions transport retries: initial attempt + up to 4 retries for HTTP 408/409/429/5xx, connection errors, and request timeouts. Each attempt has its own `timeout` deadline; for an established stream, that deadline stays active through response-body consumption. SDK-internal `maxRetries` is set to `0` to avoid a second retry loop.

Backoff honors `retry-after-ms` / `retry-after`, otherwise uses exponential delay with jitter, capped at 8 seconds. A caller signal cancels both requests and backoff. User cancellation never retries, and established streams are never reconnected or replayed.

An overall deadline can bound all rounds and transport attempts:

```ts
import { createGeminiProvider, createVenusEngine, isAbortError } from '@theogony/venus-core';

const engine = createVenusEngine({
  provider: createGeminiProvider({
    apiKey: process.env.GEMINI_API_KEY!,
    timeout: 20_000,
  }),
  defaultModel: 'gemini-3-flash-preview',
});

try {
  const result = await engine.evaluate(imageUrl, undefined, undefined, {
    signal: AbortSignal.timeout(60_000),
  });
  console.log(result.totalScore);
} catch (error) {
  if (!isAbortError(error)) throw error;
}
```

The SDK's exported `TimeoutError` class is distinct from the DOM timeout reason and provider timeout classification. Setting a provider timeout does not impose a deadline on the entire multi-round evaluation.

## See Also

- [API Reference](./api-reference.md) — Engine creation, provider setup, and type signatures
- [Usage Guide](./usage-guide.md) — End-to-end examples with streaming, web frameworks, and context extension
