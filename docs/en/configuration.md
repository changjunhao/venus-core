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
| `providers` | `ProviderConfig` | — | Per-agent custom provider instances, falls back to `provider` if not set |
| `reasoning` | `ReasoningConfig` | — | Reasoning config with global `enabled`/`effort`/`budgetTokens` and per-agent `agents` overrides |
| `maxRetries` | `number` | — | Max retry attempts per agent LLM call. Only applies to providers in `json_object` structured output mode; providers declaring `structuredOutput: 'json_schema'` use a single call without retries (see [API Reference](./api-reference.md#structuredoutput-semantics)) |
| `onEvent` | `(event: EvaluationEvent) => void` | — | Event callback for observability |

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
- **Xiaomi MIMO**: Uses `thinking: { type: "enabled" }` (same format as Kimi)
- **Zhipu (BigModel)**: Uses `thinking: { type: "enabled" }` (same format as Kimi)
- **StepFun**: Uses `reasoning_effort: "low" | "medium" | "high"` (5-level mapped to 3-level: minimal→low, max→high)
- **MiniMax**: Uses `thinking: { type: "adaptive" }` with `reasoning_split: true`
- **Doubao (Volcano Ark)**: Chat Completions uses `thinking.type` toggle + `reasoning_effort`; the Responses API endpoint (`https://ark.cn-beijing.volces.com/api/v3` via `createOpenAIResponsesProvider`) uses `thinking.type` + nested `reasoning: { effort }` (minimal→thinking disabled, xhigh→max; `reasoning.summary` is never sent)
- **Baidu Qianfan (ERNIE)**: Uses `enable_thinking: true`
- **Grok (xAI)**: Uses `reasoning_effort` (none/low/medium/high; 5-level mapped: minimal→none, max→high)
- **Gemini**: Uses `reasoning_effort` (same as OpenAI, internally mapped to thinking_level/thinking_budget)
- **DeepSeek**: Uses `reasoning_effort` + `thinking: { type: "enabled" }`
- **OpenRouter**: Uses `reasoning: { effort, max_tokens, enabled: true }`

> **Note**: When reasoning is not configured, the adapter explicitly disables thinking for endpoints whose models default to enabled (DashScope, Qianfan, Kimi, MIMO, Zhipu, MiniMax, Volcano Ark, Grok), ensuring predictable behavior.

### Doubao (Volcano Ark) Responses API

The Responses provider works with Volcano Ark's Doubao models out of the box — endpoint behavior is auto-detected from `baseURL`:

```ts
const provider = createOpenAIResponsesProvider({
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: process.env.ARK_API_KEY!,
});
```

Ark-specific optional parameters (e.g. `caching`, `service_tier`, `expire_at`) can be passed through via `defaultExtra` (per-provider) or `extra` (per-call). Note that `text.format` structured output (`json_schema`/`json_object`) is currently in beta on Volcano Ark.

## See Also

- [API Reference](./api-reference.md) — Engine creation, provider setup, and type signatures
- [Usage Guide](./usage-guide.md) — End-to-end examples with streaming, web frameworks, and context extension
