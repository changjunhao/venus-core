# 使用指南

[English](../en/usage-guide.md) | [中文](./usage-guide.md)

[← 返回 README](../../README.zh-CN.md)

## 基本评估

以下示例假设已按[快速开始](../../README.zh-CN.md#快速开始)配置引擎。请在引擎上设置 `defaultModel`（或按智能体提供 `models`）；提供商的 `defaultModel` 不会自动配置引擎。

传入图片 URL，可选指定门类。省略时引擎会自动检测。

```ts
// 自动检测门类
const result1 = await engine.evaluate('https://example.com/photo.jpg');

// 明确指定门类
const result2 = await engine.evaluate('https://example.com/portrait.jpg', 'portrait');
```

## 流式评估

`evaluateStream()` 返回一个 `AsyncGenerator`，在管线的每个阶段产出事件 — 非常适合 SSE 或实时 UI。

```ts
for await (const event of engine.evaluateStream('https://example.com/photo.jpg')) {
  switch (event.type) {
    case 'genre_detected':
      console.log('门类:', event.data.genre);
      break;
    case 'agent_complete':
      console.log(`第 ${event.round} 轮 [${event.agent}] 完成`);
      break;
    case 'evaluation_complete':
      console.log('最终评分:', event.data.totalScore);
      break;
    case 'error':
      console.error(event.error.message);
      break;
  }
}
```

### `updates` 模式流式

如需实时推理和增量 JSON 片段，使用 `mode: 'updates'`：

```ts
for await (const event of engine.evaluateStream('https://example.com/photo.jpg', {
  mode: 'updates',
})) {
  switch (event.type) {
    case 'reasoning_chunk':
      // 实时流式输出智能体推理过程
      process.stdout.write(event.content);
      break;
    case 'result_chunk':
      // 增量 JSON — 逐步更新 UI
      updateProgressBar(event.partial);
      break;
    case 'agent_complete':
      // 智能体完成 — 最终结果可用
      break;
  }
}
```

## 组图评估

`evaluateGroup()` 通过同一套对抗管线**一次评估 2 到 10 张图片**。组图模式是第二个位置参数：

| 模式      | 适用场景                | 关键结果字段                                                                                    |
| --------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `joint`   | 把系列/组照作为整体评判 | `sceneType`、`totalScore`、`dimensions`、`groupAnalysis`、`critique`、`suggestions`             |
| `compare` | 让组内图片相互对比排名  | `ranking`（每张图含 `index`、`rank`、`score`、`rationale`）、`comparisonSummary`、`suggestions` |

```ts
const imageUrls = [
  'https://example.com/wedding-01.jpg',
  'https://example.com/wedding-02.jpg',
  'https://example.com/wedding-03.jpg',
];

// 联合评估 — 把整组当作一件作品
const joint = await engine.evaluateGroup(imageUrls, 'joint', { genre: 'portrait' });
if (joint.mode === 'joint') {
  console.log(joint.totalScore); // 8.4
  console.log(joint.groupAnalysis); // 系列的叙事 / 一致性分析
}

// 对比评估 — 组内图片相互排名
const compare = await engine.evaluateGroup(imageUrls, 'compare');
if (compare.mode === 'compare') {
  for (const item of compare.ranking) {
    console.log(`第 ${item.rank} 名 → 第 ${item.index} 张图（${item.score} 分）：${item.rationale}`);
  }
}
```

返回类型是 `GroupEvaluationResult` 联合类型，因此读取 `totalScore`、`groupAnalysis`、`ranking` 等模式特有字段前，TypeScript 要求先基于 `mode` 收窄。两种模式共有的字段 — `imageUrls`、`mode`、`genre`、`suggestions`、`arbitrationNotes`、`perImage`、`process`、`metadata` — 可直接访问，无需守卫。

少于 2 张或多于 10 张会抛出 `ValidationError`。`ranking`（以及 `perImage`）中的 `index` 是输入 `imageUrls` 数组中从 0 开始的下标。

### 逐图明细（`includePerImage`）

`includePerImage` 默认为 `false`，并在**提示词与 JSON Schema 两层**同时控制：关闭时提示词不要求逐图输出、Schema 也不含 `per_image` 字段，模型根本不会生成这些 token。只在确实需要额外明细时开启：

```ts
const result = await engine.evaluateGroup(imageUrls, 'joint', { includePerImage: true });

result.perImage?.forEach((item) => {
  console.log(`第 ${item.index} 张图：${item.score} — ${item.comment}`);
});
console.log(result.metadata.includePerImage); // true
```

> 提示：组图场景请优先使用公网 HTTP(S) URL 而非 `data:` base64 URL —— 支持 URL 直传的提供商会原样透传，避免 base64 负载在每一轮中重复膨胀。

### 流式组图评估

```ts
for await (const event of engine.evaluateGroupStream(imageUrls, 'compare', {
  mode: 'updates', // 流式粒度，与上面的组图模式相互独立
})) {
  switch (event.type) {
    case 'group_evaluation_start':
      console.log(`正在评估 ${event.data.imageUrls.length} 张图片（${event.data.mode}）`);
      break;
    case 'reasoning_chunk':
      process.stdout.write(event.content);
      break;
    case 'group_evaluation_complete':
      console.log(event.data.mode === 'compare' ? event.data.ranking : event.data.totalScore);
      break;
    case 'error':
      console.error(event.error.message);
      break;
  }
}
```

事件顺序：第 0 轮 `agent_call` / `agent_complete` 与 `genre_detected`（仅在自动检测门类时）→ `group_evaluation_start` → 各轮 `agent_call` / `agent_complete` → `group_evaluation_complete`。非取消类错误（包括图片数量不在 2–10 范围内）以末尾的 `error` 事件形式产出。信号取消则以 `AbortError` 拒绝迭代，参见[端到端取消](#端到端取消)。

## Web 框架集成

### Hono（推荐）

```ts
import { Hono } from 'hono';
import { createVenusEngine, createOpenAIChatProvider } from '@theogony/venus-core';
import { createHonoAdapter } from '@theogony/venus-core/hono';

const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  defaultModel: '<your-model>',
});

const app = new Hono();
app.route(
  '/api',
  createHonoAdapter(engine, {
    hooks: {
      beforeEvaluate: async (params) => {
        // 例如：上传图片到文件 API、注入 EXIF 上下文
        return params;
      },
    },
  }),
);

export default app; // 适用于 Bun、Deno、Node、Cloudflare Workers 等
```

### Express

```ts
import express from 'express';
import { createVenusEngine, createOpenAIChatProvider } from '@theogony/venus-core';
import { createExpressAdapter } from '@theogony/venus-core/express';

const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  defaultModel: '<your-model>',
});

const app = express();
app.use(express.json());
app.use(
  '/api',
  createExpressAdapter(engine, {
    hooks: {
      beforeEvaluate: async (params) => {
        // 在评估前转换已验证的参数
        return params;
      },
    },
  }),
);
app.listen(3000);
```

### Nitro（h3）

```ts
// server/routes/api/[...].ts（Nuxt / Nitro 服务端路由）
import { useBase } from 'h3';
import { createVenusEngine, createOpenAIChatProvider } from '@theogony/venus-core';
import { createNitroAdapter } from '@theogony/venus-core/nitro';

const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  defaultModel: '<your-model>',
});

const venus = createNitroAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params) => {
      // 在评估前转换已验证的参数
      return params;
    },
  },
});

export default useBase('/api', venus.handler);
```

三种适配器暴露相同的端点：

| 方法   | 路径                           | 说明                                                |
| ------ | ------------------------------ | --------------------------------------------------- |
| `POST` | `/evaluate`                    | 同步评估                                            |
| `POST` | `/evaluate/stream`             | 流式评估（SSE / `text/event-stream`）               |
| `POST` | `/evaluate/stream/jsonl`       | 流式评估（JSON Lines / `application/x-ndjson`）     |
| `POST` | `/evaluate/group`              | 同步组图评估（2–10 张图片）                         |
| `POST` | `/evaluate/group/stream`       | 流式组图评估（SSE / `text/event-stream`）           |
| `POST` | `/evaluate/group/stream/jsonl` | 流式组图评估（JSON Lines / `application/x-ndjson`） |
| `GET`  | `/metadata`                    | 门类元数据和维度信息                                |

### 组图评估端点

三个组图端点接受相同的 JSON 请求体：

| 字段              | 类型                    | 必填 | 说明                                                           |
| ----------------- | ----------------------- | ---- | -------------------------------------------------------------- |
| `imageUrls`       | `string[]`              | 是   | 2–10 个图片 URL；指向私有/保留主机的 URL 会被拒绝（SSRF 防护） |
| `mode`            | `'joint' \| 'compare'`  | 是   | **组图评估模式**                                               |
| `genre`           | `Genre`                 | 否   | 预先指定门类；省略时自动检测                                   |
| `context`         | `EvaluationContext`     | 否   | EXIF 数据、用户备注、自定义元数据                              |
| `includePerImage` | `boolean`               | 否   | 是否要求逐图明细（默认 `false`）                               |
| `streamMode`      | `'values' \| 'updates'` | 否   | **流式粒度**，仅流式端点有效（默认 `values`）                  |

**`mode` 与 `streamMode` 的区别** —— 组图端点带有两个相互独立的开关：

| 字段         | 取值                 | 含义                                                                          | SDK 对应                                                      |
| ------------ | -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `mode`       | `joint` / `compare`  | 评估*什么*：整组联合评估，还是组内相互对比                                    | `evaluateGroup()` / `evaluateGroupStream()` 的第 2 个位置参数 |
| `streamMode` | `values` / `updates` | 事件产出的*粒度*：仅里程碑事件，还是额外含 `reasoning_chunk` / `result_chunk` | `evaluateGroupStream()` 的 `options.mode`                     |

> 单图端点的粒度字段名为 `mode`（那里不存在评估模式）。组图端点将其改名为 `streamMode`，从而让 `mode` 承载 `joint` / `compare`。

同步组图评估：

```bash
curl -X POST http://localhost:3000/api/evaluate/group \
  -H 'Content-Type: application/json' \
  -d '{
    "imageUrls": [
      "https://example.com/wedding-01.jpg",
      "https://example.com/wedding-02.jpg"
    ],
    "mode": "joint",
    "genre": "portrait",
    "includePerImage": false
  }'
```

`joint` 响应（节选）：

```json
{
  "imageUrls": ["https://example.com/wedding-01.jpg", "https://example.com/wedding-02.jpg"],
  "mode": "joint",
  "genre": "portrait",
  "sceneType": "wedding",
  "totalScore": 8.4,
  "dimensions": { "facial_expression": 8.5, "pose_body": 8.0, "lighting_quality": 8.5 },
  "groupAnalysis": "两张照片构成了连贯的叙事 ...",
  "critique": "...",
  "suggestions": ["简化背景，让注意力集中在主体上"],
  "arbitrationNotes": {
    "sceneTypeRuling": "这组照片属于婚礼人像",
    "decisions": [{ "target": "lighting_quality", "decision": "partial", "reason": "各张照片的光线控制存在差异" }],
    "finalRationale": "最终评估综合考虑人物神态与光线控制"
  },
  "process": { "proposal": {}, "critique": {}, "arbitration": {} },
  "metadata": {
    "evaluatedAt": "2026-07-29T09:12:34.567Z",
    "durationMs": 42100,
    "rounds": 3,
    "imageCount": 2,
    "includePerImage": false
  }
}
```

`compare` 响应（节选）—— 同一请求改为 `"mode": "compare"`：

```json
{
  "imageUrls": ["https://example.com/wedding-01.jpg", "https://example.com/wedding-02.jpg"],
  "mode": "compare",
  "genre": "portrait",
  "ranking": [
    { "index": 1, "rank": 1, "score": 8.5, "rationale": "光线更有层次，背景更干净" },
    { "index": 0, "rank": 2, "score": 7.5, "rationale": "神态偏平，画面元素更杂" }
  ],
  "comparisonSummary": "第二张在光线控制上领先 ...",
  "suggestions": ["简化背景，让注意力集中在主体上"],
  "arbitrationNotes": {
    "sceneTypeRuling": "这组照片属于婚礼人像",
    "decisions": [{ "target": "lighting_quality", "decision": "partial", "reason": "各张照片的光线控制存在差异" }],
    "finalRationale": "最终评估综合考虑人物神态与光线控制"
  },
  "process": { "proposal": {}, "critique": {}, "arbitration": {} },
  "metadata": {
    "evaluatedAt": "2026-07-29T09:14:02.001Z",
    "durationMs": 39800,
    "rounds": 3,
    "imageCount": 2,
    "includePerImage": false
  }
}
```

校验失败返回 `400`，响应体为 `{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }` —— 图片少于 2 张或多于 10 张、`mode` 缺失或非法、`genre` 非法，以及任一 URL 指向私有/保留主机。

通过 SSE 进行流式组图评估：

```bash
curl -N -X POST http://localhost:3000/api/evaluate/group/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "imageUrls": ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    "mode": "compare",
    "streamMode": "updates"
  }'
```

每个事件是一行 `data:`，以空行结尾（以下为节选，省略部分中间事件和结果字段）：

```text
data: {"type":"agent_call","round":0,"agent":"genreDetector","timestamp":1785000000000}

data: {"type":"genre_detected","data":{"genre":"portrait","reasoning":null},"timestamp":1785000000100}

data: {"type":"group_evaluation_start","data":{"imageUrls":["https://example.com/a.jpg","https://example.com/b.jpg"],"mode":"compare","genre":"portrait"},"timestamp":1785000000200}

data: {"type":"agent_call","round":1,"agent":"proposer","timestamp":1785000000300}

data: {"type":"reasoning_chunk","agent":"proposer","content":"正在对比两张照片 ...","timestamp":1785000000400}

data: {"type":"agent_complete","round":1,"agent":"proposer","data":{"result":{},"reasoning":null},"timestamp":1785000012000}

data: {"type":"group_evaluation_complete","data":{"mode":"compare","ranking":[]},"timestamp":1785000040000}
```

JSONL 端点产出完全相同的事件，每行一个紧凑 JSON 对象（无 `data:` 前缀），`Content-Type` 为 `application/x-ndjson`：

```bash
curl -N -X POST http://localhost:3000/api/evaluate/group/stream/jsonl \
  -H 'Content-Type: application/json' \
  -d '{"imageUrls":["https://example.com/a.jpg","https://example.com/b.jpg"],"mode":"joint"}'
```

```text
{"type":"group_evaluation_start","data":{"imageUrls":["https://example.com/a.jpg","https://example.com/b.jpg"],"mode":"joint","genre":"portrait"},"timestamp":1785000000200}
{"type":"agent_call","round":1,"agent":"proposer","timestamp":1785000000300}
{"type":"group_evaluation_complete","data":{"mode":"joint","totalScore":8.4},"timestamp":1785000040000}
```

两个流式端点在发生非取消类失败时都会追加一条末尾 `error` 事件，且 HTTP 状态码仍为 `200`（响应头已发送）。取消或客户端断连后停止写入，不补发错误或完成帧。响应头发送前的取消在仍可响应时可能映射为 HTTP `499 ABORTED`；已断开的客户端不应期待收到该响应。

## 适配器钩子

适配器暴露 `beforeEvaluate` 生命周期钩子用于请求转换。钩子接收已验证的 `EvaluateParams`，可在调用引擎前对其进行转换 — 非常适合预处理工作流。组图端点有对应的 `beforeEvaluateGroup` 钩子。

### `AdapterHooks`

```ts
interface AdapterHooks {
  /**
   * 在评估开始前调用（同步和流式端点均适用）。
   * 接收已验证的请求参数，可转换并返回修改后的参数。
   *
   * 使用场景：上传图片到提供商文件 API、注入 EXIF 上下文、
   * 覆盖门类、切换流式粒度等。
   */
  beforeEvaluate?: (params: EvaluateParams, context?: CancellationOptions) => Promise<EvaluateParams> | EvaluateParams;

  /**
   * 在组图评估开始前调用（同步和流式端点均适用）。
   * 接收已验证的组图请求参数，可转换并返回修改后的参数。
   */
  beforeEvaluateGroup?: (
    params: GroupEvaluateParams,
    context?: CancellationOptions,
  ) => Promise<GroupEvaluateParams> | GroupEvaluateParams;
}
```

可选的第二个参数包含 `signal`，原有单参数钩子保持兼容。这个执行上下文与 `params.context`（EXIF、用户元数据）不同。请将信号传给上传、元数据读取等 I/O 辅助函数；这些由应用实现的函数必须继续传给底层 `fetch` 或 SDK，仅增加但不使用参数无法中止 I/O。

### `EvaluateParams`

```ts
interface EvaluateParams {
  imageUrl: string;
  genre: Genre | null;
  context?: EvaluationContext;
  mode?: StreamMode;
}
```

### `GroupEvaluateParams`

```ts
interface GroupEvaluateParams {
  imageUrls: string[];
  mode: GroupEvaluationMode; // 'joint' | 'compare'
  genre: Genre | null;
  context?: EvaluationContext;
  includePerImage?: boolean;
  streamMode?: StreamMode; // 'values' | 'updates'
}
```

### 钩子示例：图片预上传

将图片上传到提供商的文件 API（如 Kimi）并在评估前替换 URL：

```ts
import { createHonoAdapter } from '@theogony/venus-core/hono';

const adapter = createHonoAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params, context) => {
      // 返回当前提供商支持的图片 URL
      const imageUrl = await uploadToFileAPI(params.imageUrl, { signal: context?.signal });
      return { ...params, imageUrl };
    },
  },
});
```

### 钩子示例：EXIF 注入

根据图片 URL 自动注入 EXIF 上下文：

```ts
const adapter = createExpressAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params, context) => {
      const exif = await fetchExifData(params.imageUrl, { signal: context?.signal });
      return {
        ...params,
        context: { ...params.context, exif },
      };
    },
  },
});
```

钩子在**所有单图端点**（`/evaluate`、`/evaluate/stream`、`/evaluate/stream/jsonl`）上触发，同时支持同步和异步实现。

### 钩子示例：组图预处理

`beforeEvaluateGroup` 在**全部三个组图端点**（`/evaluate/group`、`/evaluate/group/stream`、`/evaluate/group/stream/jsonl`）上触发，可改写 `GroupEvaluateParams` 的每一个字段：

```ts
const adapter = createHonoAdapter(engine, {
  hooks: {
    beforeEvaluateGroup: async (params, context) => {
      // 逐张上传图片，并为高级租户强制开启逐图明细
      const imageUrls = await Promise.all(
        params.imageUrls.map((url) => uploadToFileAPI(url, { signal: context?.signal })),
      );
      return { ...params, imageUrls, includePerImage: true };
    },
  },
});
```

`beforeEvaluate` 与 `beforeEvaluateGroup` 相互独立：单图请求永远不会触发组图钩子，反之亦然。

## 上下文扩展

Venus 支持通过 `EvaluationContext` 传递额外上下文以增强评估准确性。上下文数据贯穿整个对抗管线 — 提案者、批判者和仲裁者 — 并在结果元数据中返回。

### EXIF 数据

将 EXIF 元数据作为一等公民传入。引擎会将 EXIF 参数按**门类感知的注入深度**格式化到智能体提示中：

```ts
const result = await engine.evaluate('https://example.com/photo.jpg', 'portrait', {
  exif: {
    shutterSpeed: '1/2000',
    iso: 400,
    fNumber: 2.8,
    focalLength: 85,
    cameraModel: 'SONY ILCE-7M4',
    lensModel: 'FE 85mm F1.4 GM',
    dateTimeOriginal: '2026:03:15 14:30:00',
  },
});
```

### 用户备注

提供自由文本备注，让智能体了解拍摄条件或创作意图的额外上下文：

```ts
const result = await engine.evaluate('https://example.com/photo.jpg', 'landscape', {
  userNotes: 'Shot at sunrise with a GND graduated filter to darken the sky',
});
```

### 完整上下文示例

组合 EXIF、用户备注和自定义元数据：

```ts
const result = await engine.evaluate(imageUrl, 'sports', {
  exif: { shutterSpeed: '1/4000', iso: 1600, focalLength: 400 },
  userNotes: '2026 National Athletics Championships - 100m Final',
  custom: { event: 'National Athletics Championship' },
});

// 上下文在结果元数据中返回
console.log(result.metadata.context?.exif); // { shutterSpeed: '1/4000', ... }
console.log(result.metadata.context?.userNotes); // '2026 National Athletics ...'
```

### 通过 Web 框架适配器传递上下文

适配器（Hono / Express / Nitro）会透明地将请求体中的 `context` 传递给引擎：

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{
    "imageUrl": "https://example.com/photo.jpg",
    "genre": "portrait",
    "context": {
      "exif": { "shutterSpeed": "1/2000", "fNumber": 2.8, "iso": 400 },
      "userNotes": "Natural light outdoor portrait"
    }
  }'
```

Schema 校验自动应用：`userNotes` 限制为 2000 字符，所有 EXIF 字段均为可选。

### 门类感知的注入深度

EXIF 数据根据摄影门类以不同强度注入提示：

| 注入级别 | 门类             | 行为                                          |
| -------- | ---------------- | --------------------------------------------- |
| **高**   | 体育、自然       | EXIF 参数（快门、焦距）被强调为与评估直接相关 |
| **标准** | 人像、风光       | EXIF 作为参考参数显示                         |
| **轻量** | 建筑、商业、纪实 | 紧凑的单行摘要，不强调                        |
| **最小** | 艺术             | 明确注明仅供参考；艺术表达优先                |

始终附加免责声明：_"EXIF 数据可能经过后期处理修改；实际视觉效果为最终评判依据。"_

## 事件系统

通过 `onEvent` 订阅管线事件：

```ts
const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  defaultModel: '<your-model>',
  onEvent(event) {
    console.log(`[${event.type}] 轮次=${event.round} 智能体=${event.agent}`);
  },
});
```

| 事件类型         | 负载                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `round_start`    | `{ round, agent, data }`                                               |
| `round_complete` | `{ round }`                                                            |
| `agent_call`     | `{ round, agent }`                                                     |
| `agent_complete` | `{ round, agent, data: { result, reasoning } }`                        |
| `error`          | `{ agent, data: { error } }`                                           |
| `cancelled`      | `{ agent: 'engine', data: { code: 'ABORTED' } }`（同一作用域至多一次） |

`onEvent` 可观测全部四个单图和组图入口。每条观测事件均包含 `timestamp`，流事件则通过迭代器单独交付。`cancelled` 仅为观测事件，不是流帧；已启动的评估至多发出一次，预先取消或引擎启动前在钩子阶段取消不会发出该事件。

## 端到端取消

四个入口均支持请求级取消。每个独立请求应新建控制器或超时信号，已取消的信号无法重置。完整签名和行为矩阵参见 [API 参考](./api-reference.md#端到端取消)。

### 非流式评估

```ts
import { isAbortError } from '@theogony/venus-core';

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000);

try {
  const result = await engine.evaluate(imageUrl, 'portrait', undefined, {
    signal: controller.signal,
  });
  console.log(result.totalScore);
} catch (error) {
  if (!isAbortError(error)) throw error;
} finally {
  clearTimeout(timer);
}
```

取消操作可调用 `controller.abort()` 提前中止。仅需要截止时间时可改用 `AbortSignal.timeout(ms)`；引擎会将其作为 `AbortError` 上报，而非 SDK 的 `TimeoutError` 类。

### 流式评估与提前退出

```ts
import { isAbortError } from '@theogony/venus-core';

try {
  for await (const event of engine.evaluateStream(imageUrl, {
    mode: 'updates',
    signal: AbortSignal.timeout(30_000),
  })) {
    console.log(event);
    if (event.type === 'agent_complete') break; // 第一个智能体完成后主动停止
  }
} catch (error) {
  if (!isAbortError(error)) throw error;
}
```

`for await` 在 `break` 时调用迭代器的 `return()`，无需额外控制器即可取消未完成的工作。信号取消会以 `AbortError` 拒绝一次迭代，后续读取返回 `done`；不会补发 `error`、`evaluation_complete` 或 `group_evaluation_complete`。如果手动驱动迭代器，请在 `finally` 中调用 `await stream.return()`，并处理尚未完成的 `next()` 拒绝。

### 组图评估

信号放在第三个参数中，组图模式与流式粒度仍相互独立：

```ts
import { isAbortError } from '@theogony/venus-core';

try {
  const result = await engine.evaluateGroup(imageUrls, 'joint', {
    genre: 'portrait',
    signal: AbortSignal.timeout(60_000),
  });
  console.log(result);
} catch (error) {
  if (!isAbortError(error)) throw error;
}
```

独立的流式请求示例：

```ts
import { isAbortError } from '@theogony/venus-core';

try {
  for await (const event of engine.evaluateGroupStream(imageUrls, 'compare', {
    mode: 'updates',
    signal: AbortSignal.timeout(60_000),
  })) {
    console.log(event);
  }
} catch (error) {
  if (!isAbortError(error)) throw error;
}
```

### HTTP 客户端取消

将 `signal` 传给 `fetch`，不要放进 JSON 请求体。以下浏览器示例使用 SSE 端点，JSONL 和组图端点采用相同的取消方式：

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000);
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

try {
  const response = await fetch('/api/evaluate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, genre: 'portrait' }),
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('Missing response body');
  reader = response.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    console.log(value); // 原始字节；由应用解码并解析 SSE/JSONL
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally {
  clearTimeout(timer);
  if (reader) {
    // 流已中止时，清理错误不应覆盖原始读取错误
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
```

将取消操作绑定到 `controller.abort()`。取消响应 reader 也会停止消费，并通过传输层通知断连。Hono 使用 `Request.signal` 和响应流取消，Express 使用 Node 请求/响应事件，Nitro 根据运行时选择 Web 或 Node 机制。运行时和反向代理必须继续转发断连，取消才能到达适配器。

注意事项：

- **自定义提供商与钩子** 必须将 `params.signal` 或钩子第二个参数中的 `context?.signal` 传给实际 I/O；否则引擎只能停止等待和后续调度，并丢弃迟到结果。
- **修正轮** 使用独立 `revision` 提供商时仍会接收信号。
- **并发** 共用引擎或提供商的请求互不影响，除非调用方主动共用信号。提前结束一个流不会中止其父信号或其他请求。
- **服务端任务** 本地请求会中止，但厂商服务端是否停算或停止计费不在 SDK 保证范围内。

## 参见

- [API 参考](./api-reference.md) — 所有引擎、提供商和 Schema API 的完整类型签名
- [配置参考](./configuration.md) — `VenusEngineConfig` 完整参考和推理配置
