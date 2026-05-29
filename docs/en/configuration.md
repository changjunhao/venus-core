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
| `reasoning` | `ReasoningConfig` | — | Reasoning config with global `effort`/`budgetTokens` and per-agent `agents` overrides |
| `maxRetries` | `number` | — | Max retry attempts per agent LLM call |
| `onEvent` | `(event: EvaluationEvent) => void` | — | Event callback for observability |

## Reasoning Configuration

```ts
interface ReasoningConfig {
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
- **Qwen (DashScope)**: Uses `enable_thinking` and `thinking_budget`
- **Kimi (Moonshot)**: Uses `thinking: { type: "enabled" }`
- **Doubao (Volcano Ark)**: Uses `thinking.type` toggle + `reasoning_effort`

> **Note**: The reasoning adapter also includes scaffolding for OpenAI, Anthropic, DeepSeek, and Gemini APIs, but these have not been tested with vision-enabled models in the Venus evaluation pipeline. DeepSeek does not support vision inputs.

## See Also

- [API Reference](./api-reference.md) — Engine creation, provider setup, and type signatures
- [Usage Guide](./usage-guide.md) — End-to-end examples with streaming, web frameworks, and context extension
