# API 参考

[English](../en/api-reference.md) | [中文](./api-reference.md)

[← 返回 README](../../README.zh-CN.md)

## 核心引擎

### `createVenusEngine(config: VenusEngineConfig): VenusEngine`

工厂函数，用于创建引擎实例。

### `engine.evaluate(imageUrl, genre?, context?): Promise<EvaluationResult>`

执行完整评估。所有轮次完成后返回结果。

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `imageUrl` | `string` | 待评估图片的 URL |
| `genre` | `Genre` | 可选的门类覆盖；省略时自动检测 |
| `context` | `EvaluationContext` | 可选的上下文，包含 EXIF 数据、用户备注和自定义元数据 |

返回 `EvaluationResult`：

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

流式评估，在每个阶段产出事件：

| 事件类型 | 说明 |
|------------|-------------|
| `evaluation_start` | 评估已开始 |
| `genre_detected` | 门类自动检测结果（含推理） |
| `agent_call` | 某个智能体轮次开始 |
| `reasoning_chunk` | 实时推理文本（仅 `updates` 模式） |
| `result_chunk` | 增量 JSON 片段（仅 `updates` 模式） |
| `agent_complete` | 某个智能体轮次完成（含结果 + 推理） |
| `evaluation_complete` | 最终结果就绪 |
| `error` | 发生错误 |

`EvaluateStreamOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `genre` | `Genre \| null` | — | 预先指定门类（跳过自动检测） |
| `context` | `EvaluationContext` | — | 附加评估上下文 |
| `mode` | `'values' \| 'updates'` | `'values'` | 流式粒度模式 |

**模式对比：**

| 模式 | 行为 |
|------|----------|
| `values` | 仅发送里程碑事件：`agent_call`、`agent_complete`、`evaluation_start`、`genre_detected`、`evaluation_complete`、`error` |
| `updates` | 包含 `values` 全部事件，外加实时 `reasoning_chunk` 和 `result_chunk` 事件用于增量 UI 更新 |

## Schema 与门类工具

### `GenreEnum`

所有 8 个摄影门类的 Zod 枚举：

```ts
import { GenreEnum } from '@theogony/venus-core';
// z.enum(['portrait','landscape','documentary','fine_art','commercial','architecture','nature','sports'])
```

### `ExifDataSchema` / `EvaluationContextSchema`

`ExifData` 和 `EvaluationContext` 的 Zod Schema，导出供消费端校验使用：

```ts
import { ExifDataSchema, EvaluationContextSchema } from '@theogony/venus-core';

const exif = ExifDataSchema.parse({ shutterSpeed: '1/2000', iso: 400 });
const ctx = EvaluationContextSchema.parse({ exif, userNotes: '...' });
```

### `getSchemas(genre: Genre)`

返回 `{ proposalSchema, critiqueSchema, arbiterSchema }` — 指定门类的 Zod Schema。

### `getGenreConfig(genre: Genre): GenreConfig`

返回某个门类的完整配置，包括标签、维度和子类型。

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

返回所有门类的元数据，包括标签、维度和子类型。适用于构建 UI。

```ts
import { getMetadata } from '@theogony/venus-core';

const metadata = getMetadata();
// { portrait: { label: '人像摄影', dimensions: [...], subtypes: [...] }, ... }
```

### `getAllGenres(): string[]`

返回所有已注册门类键名的数组。

## 提供商

### `createOpenAIChatProvider(options: OpenAIChatProviderOptions): LLMProvider`

为任何 OpenAI 兼容的 Chat Completions API 创建提供商（OpenAI、DashScope、Together、vLLM 等）。端点行为（推理参数格式）在构造时会根据 `baseURL` 自动检测 — 无需手动配置。

```ts
import { createOpenAIChatProvider } from '@theogony/venus-core';

const provider = createOpenAIChatProvider({
  baseURL: 'https://api.together.xyz/v1',
  apiKey: process.env.TOGETHER_KEY!,
  defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
  timeout: 120_000,
  headers: { 'Custom-Header': 'value' },
  defaultExtra: { /* 厂商特定参数 */ },
});
```

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `baseURL` | `string` | *必填* | OpenAI 兼容 API 基础 URL |
| `apiKey` | `string` | *必填* | API 密钥 |
| `defaultModel` | `string` | — | 默认模型标识 |
| `headers` | `Record<string, string>` | — | 额外 HTTP 头 |
| `timeout` | `number` | 60000 | 请求超时（毫秒） |
| `defaultExtra` | `Record<string, unknown>` | — | 厂商特定额外参数 |

### `createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): LLMProvider`

使用 OpenAI Responses API 创建提供商。完整选项参见源码。

### `createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider`

为 Anthropic Claude 模型创建提供商，通过 Messages API 调用。

### `createGeminiProvider(options: GeminiProviderOptions): LLMProvider`

为 Google Gemini 模型创建提供商，通过 Generative Language API 调用。

### `defineProvider(options: DefineProviderOptions): LLMProvider`

通过直接实现 `chat()` 方法创建完全自定义的提供商。

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `name` | `string` | *必填* | 用于日志的提供商名称 |
| `capabilities` | `ProviderCapabilities` | — | 提供商能力标志 |
| `chat` | `(params: ChatParams) => Promise<ChatResponse>` | *必填* | 聊天补全实现 |
| `chatStream` | `(params: ChatParams) => AsyncIterable<StreamChunk>` | — | 可选的流式实现 |

`ProviderCapabilities`：

```ts
interface ProviderCapabilities {
  reasoning: boolean;       // 支持推理/思维模式
  reasoningBudget: boolean; // 支持显式 token 预算
  vision: boolean;          // 支持图像输入
  streaming: boolean;       // 支持流式
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
        reasoning: params.reasoning,  // 访问推理参数
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
    // arbiter 使用默认的 OpenAI Chat 提供商
  },
});
```

## 错误类

所有错误均继承 `VenusError` 并带有 `code` 属性：

| 错误类 | 代码 | 说明 |
|-------------|------|-------------|
| `VenusError` | `VENUS_ERROR` | 基础错误类 |
| `ValidationError` | `VALIDATION_ERROR` | 输入无效（URL 错误、未知门类） |
| `ProviderError` | `PROVIDER_ERROR` | LLM 提供商故障 |
| `SchemaError` | `SCHEMA_ERROR` | 智能体输出 Schema 校验失败 |
| `TimeoutError` | `TIMEOUT_ERROR` | 评估超时 |

`ProviderError` 包含用于细粒度诊断的额外字段：
- `provider: string` — 失败提供商的名称
- `errorCode: ProviderErrorCode` — 以下之一：`'network' | 'api_error' | 'parse_error' | 'timeout' | 'auth_error' | 'unknown'`
- `statusCode?: number` — HTTP 状态码（如适用）

```ts
import { ProviderError, ValidationError } from '@theogony/venus-core';

try {
  const result = await engine.evaluate(imageUrl);
} catch (err) {
  if (err instanceof ProviderError) {
    console.error(`提供商 ${err.provider} 调用失败: [${err.errorCode}] ${err.message}`);
  } else if (err instanceof ValidationError) {
    console.error(`输入无效: ${err.message}`);
  }
}
```

## 类型导出

所有公共类型均重新导出供消费者使用：

```ts
import type {
  // 核心类型
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
  
  // 提供商类型
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
  
  // 引擎和智能体类型
  VenusEngineConfig,
  AgentRole,
  AgentConfig,
  AgentCallResult,
  ModelConfig,
  ProviderConfig,
  
  // 结果类型
  ProposerResult,
  ArbitrationResult,
  CritiqueResult,
  CritiqueChallenge,
  SceneTypeReview,
  
  // 错误类型
  ProviderErrorCode,
  
  // 适配器类型
  AdapterOptions,
  AdapterHooks,
  EvaluateParams,
  MetadataResponse,
} from '@theogony/venus-core';
```

## 参见

- [使用指南](./usage-guide.md) — 流式评估、Web 框架集成、钩子、上下文扩展的端到端示例
- [配置参考](./configuration.md) — `VenusEngineConfig` 完整参考和推理配置
