# 配置参考

[English](../en/configuration.md) | [中文](./configuration.md)

[← 返回 README](../../README.zh-CN.md)

## VenusEngineConfig

`VenusEngineConfig` 完整参考：

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `provider` | `LLMProvider` | *必填* | LLM provider 实例（使用 `createOpenAIChatProvider` 或 `defineProvider`） |
| `defaultModel` | `string` | — | 所有智能体的默认模型（建议） |
| `models` | `ModelConfig` | — | 按智能体覆盖模型（`genreDetector`、`proposer`、`critic`、`arbiter`、`revision`） |
| `providers` | `ProviderConfig` | — | 按智能体自定义提供商实例，未设置时回退到 `provider` |
| `reasoning` | `ReasoningConfig` | — | 推理配置，支持全局 `effort`/`budgetTokens` 和按智能体 `agents` 覆盖 |
| `maxRetries` | `number` | — | 每次智能体 LLM 调用的最大重试次数 |
| `onEvent` | `(event: EvaluationEvent) => void` | — | 用于可观测性的事件回调 |

## 推理配置

```ts
interface ReasoningConfig {
  /** 应用于所有智能体的默认推理 effort（设置时） */
  effort?: 'minimal' | 'low' | 'medium' | 'high' | 'max';
  /** 推理的默认 token 预算 */
  budgetTokens?: number;
  /** 按智能体覆盖；设置为 `false` 可禁用特定智能体的推理 */
  agents?: Partial<Record<AgentRole, {
    effort: 'minimal' | 'low' | 'medium' | 'high' | 'max';  // 必填
    budgetTokens?: number;
  } | false>>;
}
```

完整配置示例：

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
      genreDetector: false,  // 禁用门类检测器的推理
    },
  },
  onEvent(event) {
    console.log(`[${event.type}] 轮次=${event.round} 智能体=${event.agent}`);
  },
});
```

引擎会自动将推理参数适配到不同的提供商 API：
- **Qwen（通义千问）**：使用 `enable_thinking` 和 `thinking_budget`
- **Kimi（月之暗面）**：使用 `thinking: { type: "enabled" }`
- **豆包 (火山方舟)**：使用 `thinking.type` 开关 + `reasoning_effort`

> **注意**：推理适配器也包含了 OpenAI、Anthropic、DeepSeek 和 Gemini API 的适配代码，但这些提供商尚未在 Venus 评估管线中使用视觉模型进行实际测试。DeepSeek 不支持视觉输入。

## 参见

- [API 参考](./api-reference.md) — 引擎创建、提供商设置和类型签名
- [使用指南](./usage-guide.md) — 含流式、Web 框架和上下文扩展的端到端示例
