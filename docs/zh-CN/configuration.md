# 配置参考

[English](../en/configuration.md) | [中文](./configuration.md)

[← 返回 README](../../README.zh-CN.md)

## VenusEngineConfig

`VenusEngineConfig` 完整参考：

| 选项           | 类型                               | 默认值 | 说明                                                                                                                                                                                                 |
| -------------- | ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`     | `LLMProvider`                      | _必填_ | LLM provider 实例（使用 `createOpenAIChatProvider` 或 `defineProvider`）                                                                                                                             |
| `defaultModel` | `string`                           | —      | 所有智能体的默认模型（建议）                                                                                                                                                                         |
| `models`       | `ModelConfig`                      | —      | 按智能体覆盖模型（`genreDetector`、`proposer`、`critic`、`arbiter`、`revision`）                                                                                                                     |
| `providers`    | `ProviderConfig`                   | —      | 按智能体自定义提供商实例，未设置时回退到 `provider`（`revision` 未设置时沿用 proposer 的提供商）                                                                                                     |
| `reasoning`    | `ReasoningConfig`                  | —      | 推理配置，支持全局 `enabled`/`effort`/`budgetTokens` 和按智能体 `agents` 覆盖                                                                                                                        |
| `maxRetries`   | `number`                           | `3`    | `json_object` 模式下包含首次调用在内的智能体总尝试次数上限；`1` 表示只尝试一次、不修复。`json_schema` 始终仅尝试一次并执行本地 Zod 校验（参见 [API 参考](./api-reference.md#structuredoutput-语义)） |
| `onEvent`      | `(event: EvaluationEvent) => void` | —      | 用于可观测性的事件回调                                                                                                                                                                               |

### 模型解析

在引擎上设置 `defaultModel`，或为其初始化的智能体角色提供 `models`。引擎不会读取提供商的 `defaultModel`；角色解析时缺少模型配置会产生 `code: 'CONFIG_ERROR'` 的 `VenusError`。图片评估需使用支持视觉输入的模型。

配置通过对象传入。环境变量加载和 API 密钥的服务端保管由调用方负责。

### 事件系统与流式评估

`onEvent` 可观测 `evaluate()`、`evaluateStream()`、`evaluateGroup()` 和 `evaluateGroupStream()`。管线事件包含 `round_start`、`agent_call`、`agent_complete`、`round_complete`、`error` 和 `cancelled`，每条均带有 `timestamp`。流迭代器单独产出单图或组图流事件，可观测性无需依赖 SSE/JSONL 解析。

`cancelled` 仅为观测事件：已启动的评估至多发出一次，预先取消或引擎启动前在钩子阶段取消不会触发它。取消不产生 `error` 观测事件或完成帧。

## 推理配置

```ts
interface ReasoningConfig {
  /** 推理是否全局启用（存在此对象时默认为 true）。设置为 `false` 可禁用所有智能体的推理。 */
  enabled?: boolean;
  /** 应用于所有智能体的默认推理 effort（设置时） */
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
  /** 推理的默认 token 预算 */
  budgetTokens?: number;
  /** 按智能体覆盖；设置为 `false` 可禁用特定智能体的推理 */
  agents?: Partial<
    Record<
      AgentRole,
      | {
          effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'; // 必填
          budgetTokens?: number;
        }
      | false
    >
  >;
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
      genreDetector: false, // 禁用门类检测器的推理
    },
  },
  onEvent(event) {
    console.log(`[${event.type}] 轮次=${event.round} 智能体=${event.agent}`);
  },
});
```

引擎会自动将推理参数适配到不同的提供商 API：

- **OpenAI**：Chat Completions 使用 `reasoning_effort`，Responses 使用 `reasoning: { effort }`。公共 `ReasoningEffort` 联合类型为 `none/minimal/low/medium/high/max/xhigh`，可用取值取决于所选模型
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

> **注意**：当未配置推理时，提供商会对默认启用思考的端点（DashScope、Qianfan、Kimi、MIMO、Zhipu、MiniMax、火山方舟、Grok、DeepSeek）显式禁用推理，确保行为可预测。

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
- 结构化输出保持严格 `json_schema` 策略——通过 `output_config.format` 下发，provider 声明 `structuredOutput: 'json_schema'`（单次智能体尝试后执行本地 Zod 校验，不进行智能体层修复）。DashScope 校验器不支持的 JSON Schema 关键字（如 `multipleOf`）会在发送前于客户端剥离。注意约束强度取决于模型系列：deepseek/glm 系列严格执行 schema，qwen 系列仅保证输出合法 JSON
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
- 结构化输出保持严格 `json_schema` 策略——通过 `output_config.format` 下发，由 GLM 系列在服务端严格执行，provider 声明 `structuredOutput: 'json_schema'`（单次智能体尝试后执行本地 Zod 校验，不进行智能体层修复）
- 认证使用 SDK 默认的 `x-api-key` 请求头（传入智谱 API Key 即可）；流式事件与官方 Messages API 一致

## 取消与超时

取消、传输截止时间和智能体尝试次数是相互独立的控制项：

| 控制项                    | 配置位置                                                                        | 作用范围与结果                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `signal`                  | `evaluate()` 的第四个参数；其余三个方法的选项对象                               | 取消整次评估及后续轮次，以 `AbortError`（`ABORTED`）拒绝                                |
| `AbortSignal.timeout(ms)` | 将返回的信号传到上述请求级位置                                                  | 整体截止时间，表现为 `AbortError`；原始 DOM `TimeoutError` 保留在 `reason` / `cause` 中 |
| 提供商 `timeout`          | OpenAI Chat、OpenAI Responses、Anthropic 或 Gemini 的构造选项，默认 `60_000` ms | 传输超时，归类为 `errorCode: 'timeout'` 的 `ProviderError`，不是整次评估的截止时间      |
| `maxRetries`              | `VenusEngineConfig`（智能体实例则为 `AgentConfig`）                             | `json_object` 智能体总尝试次数上限，默认 `3`，独立于提供商或 SDK 的传输层重试           |

`signal` 不属于 `VenusEngineConfig`、提供商构造选项、`EvaluationContext` 或 HTTP JSON 请求体。适配器从 Web 请求/流取消或 Node 连接事件生成信号，并通过第二个参数传给钩子。参见 [API 参考](./api-reference.md#端到端取消)。

### 智能体尝试次数

- `json_schema`：单次智能体尝试后执行本地 Zod 校验，不进行智能体层修复；提供商传输层仍可能重试。
- `json_object`：最多执行 `maxRetries` 次总尝试。非流式调用重试提供商、JSON 解析及校验错误；流式调用仅重试完整输出的解析或校验错误，传输错误直接向上传播。
- 取消不进入重试循环，也不会包装为 `SchemaError`。其他耗尽尝试次数的 `json_object` 错误会变成 `SchemaError`，因此提供商超时到达引擎边界时不一定仍是 `ProviderError`。

### Gemini 传输层重试

提供商管理 Interactions 传输重试：首次尝试后，对 HTTP 408/409/429/5xx、连接错误和请求超时最多再重试 4 次。每次尝试有独立的 `timeout` 截止时间，流建立后该截止时间持续覆盖响应体消费。SDK 内部 `maxRetries` 设为 `0`，避免叠加第二层重试循环。

退避优先读取 `retry-after-ms` / `retry-after`，否则使用带抖动的指数延迟，上限为 8 秒。调用方信号可同时取消请求和退避等待；用户取消不重试，已建立的流不重连或重放。

可用整体截止时间限制全部轮次和传输尝试：

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

SDK 导出的 `TimeoutError` 类、DOM 超时原因和提供商超时分类是不同概念。设置提供商超时不会自动限制整个多轮评估的耗时。

## 参见

- [API 参考](./api-reference.md) — 引擎创建、提供商设置和类型签名
- [使用指南](./usage-guide.md) — 含流式、Web 框架和上下文扩展的端到端示例
