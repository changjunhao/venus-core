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

## 组图评估

组图评估对**一次 2 到 10 张图片**运行与单图完全相同的对抗管线（门类检测 → 提案者 → 批判者 →（必要时）修订 → 仲裁者）。每一轮都会把全部图片随消息传入，因此智能体是把这组图当作一个整体来评判，而非把多次单图评分机械聚合。

提供两种模式：

| 模式 | 含义 | 输出侧重 |
|------|---------|--------------|
| `joint` | 把多张图片作为一个系列/组照整体评估 | 组级 `sceneType`、`totalScore`、门类 `dimensions`，以及关于叙事与一致性的 `groupAnalysis` |
| `compare` | 组内图片相互对比 | 完整 `ranking`（每张图的排名、分数、依据）与 `comparisonSummary` |

### `engine.evaluateGroup(imageUrls, mode, options?): Promise<GroupEvaluationResult>`

执行完整组图评估。所有轮次完成后返回结果。

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `imageUrls` | `string[]` | 待评估图片的 URL 数组 — **2 到 10 张**；超出范围抛出 `ValidationError` |
| `mode` | `'joint' \| 'compare'` | 组图评估模式 |
| `options` | `GroupEvaluateOptions` | 可选配置（见下） |

`GroupEvaluateOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `genre` | `Genre \| null` | — | 为整组预先指定门类（跳过自动检测） |
| `context` | `EvaluationContext` | — | 附加评估上下文（EXIF 数据、用户备注、自定义元数据） |
| `includePerImage` | `boolean` | `false` | 是否额外要求逐图明细（`perImage`） |

**`includePerImage` 与 token 成本**：该参数在**提示词与 JSON Schema 两层**同时控制。为 `false`（默认）时，提示词不要求逐图输出、Schema 也不含 `per_image` 字段，模型根本不会生成这些 token —— 是真实的节省，而非生成后过滤。为 `true` 时 Schema 增加 `per_image` 数组（长度必须等于图片数量），每项包含 `index` / `score` / `comment`。

返回 `GroupEvaluationResult` —— 按 `mode` 收窄的判别联合类型：

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
  suggestions: string;
  arbitrationNotes: string;
  perImage?: PerImageDetail[];        // 仅当 includePerImage: true
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
  suggestions: string;
  arbitrationNotes: string;
  perImage?: PerImageDetail[];        // 仅当 includePerImage: true
  process: { /* 结构相同，结果类型为 GroupCompare* 系列 */ };
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
  index: number;    // 在输入 imageUrls 数组中的位置（从 0 开始）
  score: number;
  comment: string;
}
```

`ranking` 与 `perImage` 中的 `index` 始终表示**输入 `imageUrls` 数组中从 0 开始的下标**，因此无论排名如何都能映射回原始顺序。

### `engine.evaluateGroupStream(imageUrls, mode, options?): AsyncGenerator<GroupEvaluationStreamEvent>`

流式组图评估。`GroupEvaluateStreamOptions` 在 `GroupEvaluateOptions` 基础上增加流式粒度：

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `genre` | `Genre \| null` | — | 预先指定门类（跳过自动检测） |
| `context` | `EvaluationContext` | — | 附加评估上下文 |
| `includePerImage` | `boolean` | `false` | 是否要求逐图明细 |
| `mode` | `'values' \| 'updates'` | `'values'` | 流式粒度模式（组图模式是第二个位置参数，二者互不冲突） |

| 事件类型 | 说明 |
|------------|-------------|
| `group_evaluation_start` | 组图评估已开始（`{ imageUrls, mode, genre }`） |
| `genre_detected` | 整组的门类自动检测结果 |
| `agent_call` | 某个智能体轮次开始 |
| `reasoning_chunk` | 实时推理文本（仅 `updates` 模式） |
| `result_chunk` | 增量 JSON 片段（仅 `updates` 模式） |
| `agent_complete` | 某个智能体轮次完成（含结果 + 推理） |
| `group_evaluation_complete` | 最终 `GroupEvaluationResult` 就绪 |
| `error` | 发生错误（图片数量越界也走此事件） |

事件顺序：第 0 轮 `agent_call` / `agent_complete` 与 `genre_detected`（仅在自动检测门类时）→ `group_evaluation_start` → 各轮 `agent_call` / `agent_complete` → `group_evaluation_complete`。失败（包括图片数量不在 2–10 范围内）以末尾的 `error` 事件形式产出，而不是抛出异常。

```ts
for await (const event of engine.evaluateGroupStream(imageUrls, 'compare')) {
  if (event.type === 'group_evaluation_complete') {
    console.log(event.data.ranking);
  }
}
```

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

### `getGroupJointSchemas(genre, includePerImage, imageCount)`

返回 `{ proposalSchema, arbiterSchema }` — `joint` 组图评估的 Zod Schema。批判轮直接复用 `getSchemas()` 中的通用 `critiqueSchema`，因此不包含在返回值中。

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `genre` | `Genre` | 决定场景子类型枚举与评分维度的门类 |
| `includePerImage` | `boolean` | 为 `true` 时 Schema 增加 `per_image` 数组；为 `false` 时完全不含该字段 |
| `imageCount` | `number` | 组内图片数量 — 决定 `per_image` 数组的固定长度及 `index` 的取值范围 |

```ts
import { getGroupJointSchemas } from '@theogony/venus-core';

const { proposalSchema, arbiterSchema } = getGroupJointSchemas('portrait', true, 3);
proposalSchema.parse({
  scene_type: 'wedding',
  total_score: 8.4,
  dimensions: { facial_expression: 8.5 /* ... */ },
  group_analysis: '...',
  critique: '...',
  suggestions: '...',
  per_image: [
    { index: 0, score: 8.2, comment: '...' },
    { index: 1, score: 8.6, comment: '...' },
    { index: 2, score: 8.4, comment: '...' },
  ],
});
```

### `getGroupCompareSchemas(imageCount, includePerImage)`

返回 `{ proposalSchema, arbiterSchema }` — `compare` 组图评估的 Zod Schema。注意**参数顺序与 joint 版本不同**：`compare` 的输出与门类无关，因此没有 `genre` 参数。

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `imageCount` | `number` | 组内图片数量 — 决定 `ranking`（以及 `per_image`）数组的固定长度 |
| `includePerImage` | `boolean` | 为 `true` 时 Schema 增加 `per_image` 数组 |

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
  suggestions: '...',
});
```

两个工厂函数都按参数组合缓存结果，相同参数的重复调用会返回同一个 Schema 实例。`arbiterSchema` 即 `proposalSchema` 的结构再加上必填的 `arbitration_notes` 字符串。

两者共同强制的校验规则：

| 规则 | 适用字段 |
|------|-----------|
| 数组长度必须等于 `imageCount` | `ranking`、`per_image` |
| `index` 必须是 `0..imageCount - 1` 范围内的整数，且各项不得重复 | `ranking`、`per_image` |
| `rank` 必须是整数，且构成 `1..imageCount` 的一个无重复排列 | `ranking` |
| 文本字段（`rationale`、`comment`、`comparison_summary`、`group_analysis`、`critique`、`suggestions`）不得为空 | 两种模式 |

### `getProposerResultSchema(genre: Genre)`

返回指定门类的完整评估结果 Zod Schema,包括所有嵌套的 `process` 和 `metadata` 字段。适用于验证自定义评估结果或构建自定义适配器。

```ts
import { getProposerResultSchema } from '@theogony/venus-core';

const schema = getProposerResultSchema('portrait');
const validated = schema.parse({
  imageUrl: '...',
  genre: 'portrait',
  sceneType: 'studio',
  totalScore: 8.5,
  // ... 完整评估结果结构
});
```

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
| `includeUsage` | `boolean` | `true` | 是否在流式模式下通过 `stream_options.include_usage` 请求 token 用量统计。对于不支持此参数的端点，设置为 `false`。 |

> **关于结构化输出**：此提供商声明 `structuredOutput: 'json_object'`。传入的任何
> `json_schema` 类型的 `response_format` 都会**降级为 `json_object`**（schema 不会发送
> 到端点）并输出警告日志。当前有意不做 schema 强制执行；后续版本可能对已验证支持
> 的端点透传 `json_schema`。如需严格 schema 强制执行，请使用
> `createOpenAIResponsesProvider`。

### `createOpenAIResponsesProvider(options: OpenAIResponsesProviderOptions): LLMProvider`

使用 OpenAI Responses API（`/v1/responses`）创建提供商，适用于推理型模型（o 系列、GPT-5）。声明 `structuredOutput: 'json_schema'`，通过 `text.format` 支持严格 JSON Schema 输出。

```ts
import { createOpenAIResponsesProvider } from '@theogony/venus-core';

const provider = createOpenAIResponsesProvider({
  baseURL: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_KEY!,
  defaultModel: 'gpt-5',
});
```

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `baseURL` | `string` | *必填* | OpenAI API 基础 URL |
| `apiKey` | `string` | *必填* | API 密钥 |
| `defaultModel` | `string` | — | 默认模型标识 |
| `headers` | `Record<string, string>` | — | 额外 HTTP 头 |
| `timeout` | `number` | 60000 | 请求超时（毫秒） |
| `defaultExtra` | `Record<string, unknown>` | — | 提供商特定的默认额外参数 |
| `includeUsage` | `boolean` | `true` | 是否在流式模式下请求 token 用量统计 |

### `createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider`

为 Anthropic Claude 模型创建提供商，基于 `@anthropic-ai/sdk` 的 Messages API（`client.messages.create`）实现。声明 `structuredOutput: 'json_schema'`，通过 `output_config.format` 在服务端强制执行严格 JSON Schema 输出。

首个 system/developer 消息会被提升为顶层 `system` 参数（Messages API 无 `system` 角色），其余轮次映射为 `user`/`assistant`。公网图片 URL 以 `{ type: 'image', source: { type: 'url' } }` 块直接透传（无需客户端下载）；`data:` URL 转为内联 base64 图片源。推理努力级别映射为扩展思考（`thinking: { type: 'enabled', budget_tokens }`，预算取自 `budgetTokens` 或 effort 等级，并限定 ≥ 1024）；思考块作为 `reasoning` 内容返回，`usage.output_tokens_details.thinking_tokens` 作为 `reasoningTokens` 上报。启用思考时会省略 `temperature`（API 要求其为 1）。Messages API 要求 `max_tokens`，依次取自 `extra.max_tokens`、`defaultMaxTokens`，默认 4096，并会自动提升至高于思考预算。

```ts
import { createAnthropicProvider } from '@theogony/venus-core';

const provider = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: 'claude-sonnet-4-5',
});
```

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `apiKey` | `string` | *必填* | Anthropic API 密钥 |
| `defaultModel` | `string` | — | 默认模型标识符 |
| `baseURL` | `string` | `https://api.anthropic.com` | API 基础 URL 覆盖 |
| `timeout` | `number` | 60000 | 请求超时（毫秒） |
| `headers` | `Record<string, string>` | — | 额外 HTTP 请求头 |
| `defaultExtra` | `Record<string, unknown>` | — | 提供商特定的默认额外参数 |
| `defaultMaxTokens` | `number` | 4096 | 未通过 `extra.max_tokens` 提供时的默认 `max_tokens` |

### `createGeminiProvider(options: GeminiProviderOptions): LLMProvider`

为 Google Gemini 模型创建提供商，基于 `@google/genai` 的 Interactions API 实现。声明 `structuredOutput: 'json_schema'`，通过 `response_format` 强制执行严格 JSON Schema 输出。需使用 Gemini 2.5+ / 3.x 系列模型。

公网图片 URL 会以 `{ type: 'image', uri }` 块直接透传给 API（无需客户端下载）；`data:` URL 会转换为内联 base64 图片块。推理努力级别映射到 `generation_config.thinking_level`（`none`/`minimal` → `minimal`，`high`/`max`/`xhigh` → `high`），思考摘要作为推理内容返回；`budgetTokens` 不被 Interactions API 支持，会被忽略。

```ts
import { createGeminiProvider } from '@theogony/venus-core';

const provider = createGeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  defaultModel: 'gemini-3-flash-preview',
});
```

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `apiKey` | `string` | *必填* | Gemini API 密钥 |
| `defaultModel` | `string` | — | 默认模型标识符 |
| `baseURL` | `string` | `https://generativelanguage.googleapis.com` | API 基础 URL 覆盖 |
| `timeout` | `number` | 60000 | 请求超时（毫秒） |
| `headers` | `Record<string, string>` | — | 额外 HTTP 请求头 |
| `defaultExtra` | `Record<string, unknown>` | — | 提供商特定的默认额外参数 |

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
  structuredOutput?: 'json_object' | 'json_schema'; // 结构化输出支持（见下文）
}
```

#### `structuredOutput` 语义

`structuredOutput` 能力决定智能体如何请求和校验 JSON 输出：

| 取值 | 智能体行为 |
|------|-----------|
| `'json_object'` 或省略 | 请求 `response_format: { type: 'json_object' }`。智能体解析 JSON、用 Zod schema 校验，并在失败时携带修复提示重试最多 `maxRetries` 次；全部失败后抛出 `SchemaError`。 |
| `'json_schema'` | 智能体从 Zod schema 构建严格 JSON Schema，发送 `response_format: { type: 'json_schema', ... }`，**单次调用 — 不重试、不做本地 Zod 校验**（`maxRetries` 不适用）。schema 合规性完全信任提供商/API。若响应不是合法 JSON，立即抛出 `errorCode: 'parse_error'` 的 `ProviderError`。 |

> **警告**：仅当底层 API 确实保证 schema 合规输出时（如 OpenAI Responses API），才应在
> 自定义提供商上声明 `structuredOutput: 'json_schema'`。声明后会完全禁用智能体侧的
> 校验/修复循环。

内置提供商支持情况：

| 提供商 | `structuredOutput` | 说明 |
|--------|--------------------|------|
| `createOpenAIChatProvider` | `'json_object'` | `json_schema` response_format 会降级为 `json_object` 并输出警告 |
| `createOpenAIResponsesProvider` | `'json_schema'` | 通过 `text.format` 支持严格 schema；小米 MiMo 端点声明 `'json_object'`（其 `text.format` 不支持 json_schema 强约束） |
| `createAnthropicProvider` | `'json_schema'` | 通过 `output_config.format` 由服务端强制执行严格 schema；DashScope 兼容端点会在客户端剥离不支持的 schema 关键字（如 `multipleOf`） |
| `createGeminiProvider` | `'json_schema'` | 通过 `response_format` 支持严格 schema（Interactions API） |

#### 流式 JSON 增量（`StreamChunk.partial`）

所有内置提供商在 `chatStream()` 过程中都会通过 `StreamChunk` 的 `partial` 字段
产出增量 JSON 快照：

- `content` — 提供商返回的原始文本增量。
- `reasoning` — 推理/思考文本增量（如有）。
- `partial` — 从累积的 `content` 流中解析出的增量 JSON 对象。当尚无可解析的
  JSON 值或解析失败时会省略该字段，因此消费方必须将其视为每个 chunk 上的可选字段。

`partial` 是 `evaluateStream()` 在 `mode: 'updates'` 下产出的引擎级 `result_chunk`
事件的数据来源，可用于对评估 JSON 做增量 UI 渲染，无需自行重新解析拼接文本。

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

内置 LLM SDK 抛出的错误（OpenAI Chat Completions / Responses、Anthropic Messages API、
Google GenAI）现均由提供商层统一集中分类——对 `chat()` 和 `chatStream()` 的初始请求阶段同样适用：
HTTP 401/403 → `auth_error`，连接超时 → `timeout`，DNS/连接失败 → `network`，
其他 HTTP ≥ 400 → `api_error`，其余 → `unknown`。

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

  // 组图评估类型
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
  VenusError,
  ValidationError,
  ProviderError,
  SchemaError,
  TimeoutError,
  
  // 适配器类型
  AdapterOptions,
  AdapterHooks,
  EvaluateParams,
  GroupEvaluateParams,
  GroupEvaluateRequestBody,
  MetadataResponse,
} from '@theogony/venus-core';
```

## 参见

- [使用指南](./usage-guide.md) — 流式评估、Web 框架集成、钩子、上下文扩展的端到端示例
- [配置参考](./configuration.md) — `VenusEngineConfig` 完整参考和推理配置
