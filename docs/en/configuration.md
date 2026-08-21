# Configuration Reference

[English](./configuration.md) | [中文](../zh-CN/configuration.md)

[← Back to README](../../README.md)

## VenusEngineConfig

`VenusEngineConfig` full reference:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `LLMProvider` | *required* | LLM provider instance (use `createOpenAIChatProvider` or `defineProvider`) |
| `defaultModel` | `string` | — | Default model for all agents (recommended) |
| `models` | `ModelConfig` | — | Per-agent model overrides (`genreDetector`, `proposer`, `critic`, `arbiter`, `revision`) |
| `providers` | `ProviderConfig` | — | Per-agent custom provider instances, falls back to `provider` if not set (`revision` falls back to the proposer's provider) |
| `reasoning` | `ReasoningConfig` | — | Reasoning config with global `enabled`/`effort`/`budgetTokens` and per-agent `agents` overrides |
| `maxRetries` | `number` | — | Max retry attempts per agent LLM call. Only applies to providers in `json_object` structured output mode; providers declaring `structuredOutput: 'json_schema'` use a single call without retries (see [API Reference](./api-reference.md#structuredoutput-semantics)) |
| `onEvent` | `(event: EvaluationEvent) => void` | — | Event callback for observability |

### Event System and Streaming

`onEvent` fires for both `evaluate()` and `evaluateStream()`. For streaming evaluations
the engine emits the same pipeline-stage events (`round_start`, `agent_call`,
`agent_complete`, `round_complete`, `error`) alongside the yielded
`EvaluationStreamEvent` stream, so observability hooks work without parsing the SSE body.

## Reasoning Configuration

```ts
interface ReasoningConfig {
  /** Whether reasoning is enabled globally (default: true when this object is present). Set to `false` to disable reasoning for all agents. */
  enabled?: boolean;
  /** Default reasoning effort applied to all agents (when set) */
  effort?: 'minimal' | 'low' | 'medium' | 'high' | 'max';
  /** Default token budget for reasoning */
  budgetTokens?: number;
  /** Per-agent overrides; set to `false` to disable reasoning for a specific agent */
  agents?: Partial<Record<AgentRole, {
    effort: 'minimal' | 'low' | 'medium' | 'high' | 'max';  // Required
    budgetTokens?: number;
  } | false>>;
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
      genreDetector: false,  // Disable reasoning for genre detector
    },
  },
  onEvent(event) {
    console.log(`[${event.type}] round=${event.round} agent=${event.agent}`);
  },
});
```

The engine automatically adapts reasoning parameters to different provider APIs:
- **OpenAI**: Uses `reasoning_effort` (minimal/low/medium/high/max)
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

> **Note**: When reasoning is not configured, the adapter explicitly disables thinking for endpoints whose models default to enabled (DashScope, Qianfan, Kimi, MIMO, Zhipu, MiniMax, Volcano Ark, Grok, DeepSeek), ensuring predictable behavior.

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
- Structured output keeps the strict `json_schema` strategy via `output_config.format` — the provider reports `structuredOutput: 'json_schema'` (single call, no retries). JSON Schema keywords rejected by DashScope's validator (e.g. `multipleOf`) are stripped client-side before sending. Note the enforcement level depends on the model series: deepseek/glm enforce the schema strictly, while the qwen series only guarantees valid JSON output
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
- Structured output keeps the strict `json_schema` strategy via `output_config.format`, enforced server-side by the GLM series — the provider reports `structuredOutput: 'json_schema'` (single call, no retries)
- Authentication uses the SDK's default `x-api-key` header (pass your Zhipu API key); streaming events match the official Messages API

## See Also

- [API Reference](./api-reference.md) — Engine creation, provider setup, and type signatures
- [Usage Guide](./usage-guide.md) — End-to-end examples with streaming, web frameworks, and context extension
