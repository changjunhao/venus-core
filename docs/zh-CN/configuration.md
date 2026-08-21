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
| `providers` | `ProviderConfig` | — | 按智能体自定义提供商实例，未设置时回退到 `provider`（`revision` 未设置时沿用 proposer 的提供商） |
| `reasoning` | `ReasoningConfig` | — | 推理配置，支持全局 `enabled`/`effort`/`budgetTokens` 和按智能体 `agents` 覆盖 |
| `maxRetries` | `number` | — | 每次智能体 LLM 调用的最大重试次数。仅适用于 `json_object` 结构化输出模式的提供商；声明 `structuredOutput: 'json_schema'` 的提供商单次调用不重试（参见 [API 参考](./api-reference.md#structuredoutput-语义)） |
| `onEvent` | `(event: EvaluationEvent) => void` | — | 用于可观测性的事件回调 |

### 事件系统与流式评估

`onEvent` 在 `evaluate()` 与 `evaluateStream()` 中都会触发。流式评估时，引擎会在产出
`EvaluationStreamEvent` 流的同时发出相同的管线阶段事件（`round_start`、`agent_call`、
`agent_complete`、`round_complete`、`error`），可观测性钩子无需解析 SSE 响应体即可工作。

## 推理配置

```ts
interface ReasoningConfig {
  /** 推理是否全局启用（存在此对象时默认为 true）。设置为 `false` 可禁用所有智能体的推理。 */
  enabled?: boolean;
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
- **OpenAI**：使用 `reasoning_effort`（minimal/low/medium/high/max）
- **Qwen（通义千问）**：使用 `enable_thinking` 和 `thinking_budget`
- **Kimi（月之暗面）**：使用 `thinking: { type: "enabled" }`
- **小米 MiMo**：Chat Completions 使用 `thinking: { type: "enabled" }`（格式与 Kimi 相同）；Responses API 端点（通过 `createOpenAIResponsesProvider` 配合 `https://api.xiaomimimo.com/v1`）仅使用嵌套 `reasoning: { effort }`（`none` 关闭思考，minimal→none，max/xhigh→high；不会发送 `reasoning.summary`，temperature 由模型内部管理）
- **智谱（BigModel）**：使用 `thinking: { type: "enabled" }`（格式与 Kimi 相同）；Anthropic 兼容端点（通过 `createAnthropicProvider` 配合 `https://open.bigmodel.cn/api/anthropic`）同样自动检测，启用思考时不发送 `budget_tokens`（GLM 无思考预算）
- **阶跃星辰（StepFun）**：使用 `reasoning_effort: "low" | "medium" | "high"`（五级映射为三级：minimal→low，max→high）
- **MiniMax**：使用 `thinking: { type: "adaptive" }` 并强制 `reasoning_split: true`
- **豆包（火山方舟）**：Chat Completions 使用 `thinking.type` 开关 + `reasoning_effort`；Responses API 端点（通过 `createOpenAIResponsesProvider` 配合 `https://ark.cn-beijing.volces.com/api/v3`）使用 `thinking.type` + 嵌套 `reasoning: { effort }`（minimal→关闭思考，xhigh→max；不会发送 `reasoning.summary`）
- **百度千帆（ERNIE）**：使用 `enable_thinking: true`
- **Grok（xAI）**：使用 `reasoning_effort`（none/low/medium/high；五级映射：minimal→none，max→high）
- **Gemini**：OpenAI 兼容端点使用 `reasoning_effort`（与 OpenAI 相同，内部映射为 thinking_level/thinking_budget）；原生 `createGeminiProvider`（Interactions API）将努力级别直接映射为 `generation_config.thinking_level`（none/minimal→minimal，high/max/xhigh→high）并设置 `thinking_summaries: "auto"`
- **DeepSeek**：Chat Completions 使用 `thinking.type` 开关 + `reasoning_effort`（仅支持 low/high/max；客户端映射：none/minimal→关闭思考，medium/xhigh→high）；Responses API 端点（`createOpenAIResponsesProvider` 配合 `https://api.deepseek.com`）使用嵌套 `reasoning: { effort }`（none/low/high/max；`none` 关闭思考，不会发送 `reasoning.summary`）。DeepSeek v4 系列（含视觉模型 `deepseek-v4-flash-vision-exp`）默认开启思考，未配置推理时会显式发送禁用参数
- **OpenRouter**：使用 `reasoning: { effort, max_tokens, enabled: true }`

> **注意**：当未配置推理时，适配器会对默认启用思考的端点（DashScope、Qianfan、Kimi、MIMO、Zhipu、MiniMax、火山方舟、Grok、DeepSeek）显式禁用推理，确保行为可预测。

### 豆包（火山方舟）Responses API

Responses provider 可直接对接火山方舟的豆包模型——端点行为从 `baseURL` 自动检测：

```ts
const provider = createOpenAIResponsesProvider({
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: process.env.ARK_API_KEY!,
});
```

火山特有的可选参数（如 `caching`、`service_tier`、`expire_at`）可通过 `defaultExtra`（provider 级）或 `extra`（单次调用级）透传。注意：火山方舟的 `text.format` 结构化输出（`json_schema`/`json_object`）目前处于 beta 阶段。

### 小米 MiMo Responses API

Responses provider 同样可直接对接小米 MiMo 模型（如 `mimo-v2.5-pro`）——端点行为从 `baseURL` 自动检测：

```ts
const provider = createOpenAIResponsesProvider({
  baseURL: 'https://api.xiaomimimo.com/v1',
  apiKey: process.env.MIMO_API_KEY!,
});
```

自动处理的 MiMo 特性：

- 思考通过嵌套 `reasoning: { effort }` 控制（`none`/`low`/`medium`/`high`）；未配置推理时始终显式发送 `effort: 'none'`，避免模型回退到默认开启思考
- 不会发送 `temperature`（MiMo 由模型内部管理），也不会发送 `reasoning.summary`（非文档化请求参数）
- 结构化输出仅支持 `json_object` —— `json_schema` 响应格式会自动降级为 `json_object` 并输出警告（schema 约束回退到引擎侧校验）
- 流式推理通过 `response.reasoning_text.delta` 事件输出，会作为常规 `reasoning` 块透出

MiMo 还支持 `api-key` 请求头作为 `Authorization: Bearer` 的替代认证方式；SDK 默认的 Bearer 认证开箱即用，如有需要可通过 `headers` 选项切换。

### DeepSeek 视觉模型（deepseek-v4-flash-vision-exp）

DeepSeek 的视觉模型 `deepseek-v4-flash-vision-exp` 同时支持 Chat Completions 与 Responses API 两条路径，端点行为从 `baseURL` 自动检测。

**Responses API**：

```ts
const provider = createOpenAIResponsesProvider({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  defaultModel: 'deepseek-v4-flash-vision-exp',
});
```

**Chat Completions**：

```ts
const provider = createOpenAIChatProvider({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY!,
  defaultModel: 'deepseek-v4-flash-vision-exp',
});
```

自动处理的 DeepSeek 特性：

- **结构化输出统一走 `json_object` + 引擎侧重试**：尽管 DeepSeek Responses API 文档声明完整支持 `text.format`，实测 `deepseek-v4-flash-vision-exp` 并不可靠地强制执行 `json_schema` 约束（输出可能缺失必需字段），因此两条路径的 `json_schema` 均自动降级为 `json_object` 并输出警告，由引擎侧 Zod 校验 + 自动修复重试兜底（同时覆盖 DeepSeek JSON Output 概率性返回空 content 的问题）
- **思考模式默认开启**：DeepSeek v4 系列默认以 effort=high 思考。未配置推理时，Chat Completions 显式发送 `thinking: { type: 'disabled' }`，Responses API 显式发送 `reasoning: { effort: 'none' }`，保证标准模式行为可预测、不产生额外思考 token。如需思考，显式配置 `reasoning`（effort 客户端映射：none/minimal→关闭思考，medium/xhigh→high，low/high/max 原样）
- Responses API 不发送 `reasoning.summary`（DeepSeek 接受但不生成摘要）；思考模式下 `temperature` 不生效但不报错，配置推理时会省略
- 图片以标准 `image_url` 块传入（仅允许出现在 user 消息，引擎天然满足），支持 base64 data URL 与外部 http(s) URL。建议优先传 URL：多智能体管线每轮会重复发送图片，URL 由 DeepSeek 服务端下载，避免 base64 重复上传。注意每张图片的 token 消耗存在上限（约 384，DeepSeek 会自动将图片缩放到约 800×800 等效像素）

DeepSeek 图片限制：请求体最大 48 MiB、单张图片（base64/URL）≤32 MiB、支持 JPEG/PNG/GIF/WebP、外部 URL ≤8192 字符且需在 60 秒内可下载。

### 阿里云百炼（DashScope）Anthropic 兼容端点

Anthropic provider 可直接对接阿里云百炼的 Anthropic 兼容 Messages API——端点行为从 `baseURL` 自动检测：

```ts
const provider = createAnthropicProvider({
  baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  defaultModel: 'qwen3.7-plus',
});
```

`baseURL` 填写到 `/apps/anthropic` 为止（不要以 `/v1/` 结尾）。除北京地域外还支持新加坡（`dashscope-intl.aliyuncs.com`）、美国（`dashscope-us.aliyuncs.com`）以及业务空间专属域名（`https://{WorkspaceId}.<region>.maas.aliyuncs.com/apps/anthropic`）。

自动处理的 DashScope 特性：

- 未配置推理时显式发送 `thinking: { type: 'disabled' }`（部分 qwen 模型默认开启思考），此时 `temperature` 照常转发；配置推理时与官方一致（`thinking: { type: 'enabled', budget_tokens }`，省略 `temperature`）
- 结构化输出保持严格 `json_schema` 策略——通过 `output_config.format` 下发，provider 声明 `structuredOutput: 'json_schema'`（单次调用，不重试）。DashScope 校验器不支持的 JSON Schema 关键字（如 `multipleOf`）会在发送前于客户端剥离。注意约束强度取决于模型系列：deepseek/glm 系列严格执行 schema，qwen 系列仅保证输出合法 JSON
- 认证使用 SDK 默认的 `x-api-key` 请求头（传入百炼 API Key 即可）；流式事件与官方 Messages API 一致

### 智谱（BigModel）Anthropic 兼容端点

Anthropic provider 同样可直接对接智谱的 Claude 兼容 API——端点行为从 `baseURL` 自动检测：

```ts
const provider = createAnthropicProvider({
  baseURL: 'https://open.bigmodel.cn/api/anthropic',
  apiKey: process.env.ZHIPU_API_KEY!,
  defaultModel: 'glm-4.6',
});
```

`baseURL` 填写到 `/api/anthropic` 为止（不要以 `/v1/` 结尾）。

自动处理的智谱特性：

- 未配置推理时显式发送 `thinking: { type: 'disabled' }`（GLM 系列默认开启思考，部分型号强制思考），此时 `temperature` 照常转发；配置推理时发送 `thinking: { type: 'enabled' }`（GLM 不支持思考预算，不发送 `budget_tokens`，`temperature` 省略），`max_tokens` 仍按 effort 对应的预算扩容以为思考留出空间
- 结构化输出保持严格 `json_schema` 策略——通过 `output_config.format` 下发，由 GLM 系列在服务端严格执行，provider 声明 `structuredOutput: 'json_schema'`（单次调用，不重试）
- 认证使用 SDK 默认的 `x-api-key` 请求头（传入智谱 API Key 即可）；流式事件与官方 Messages API 一致

## 参见

- [API 参考](./api-reference.md) — 引擎创建、提供商设置和类型签名
- [使用指南](./usage-guide.md) — 含流式、Web 框架和上下文扩展的端到端示例
