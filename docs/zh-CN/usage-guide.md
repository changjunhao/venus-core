# 使用指南

[English](../en/usage-guide.md) | [中文](./usage-guide.md)

[← 返回 README](../../README.zh-CN.md)

## 基本评估

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
});

const app = new Hono();
app.route('/api', createHonoAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params) => {
      // 例如：上传图片到文件 API、注入 EXIF 上下文
      return params;
    },
  },
}));

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
});

const app = express();
app.use(express.json());
app.use('/api', createExpressAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params) => {
      // 在评估前转换已验证的参数
      return params;
    },
  },
}));
app.listen(3000);
```

两种适配器暴露相同的端点：

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST` | `/evaluate` | 同步评估 |
| `POST` | `/evaluate/stream` | 流式评估（SSE / `text/event-stream`） |
| `POST` | `/evaluate/stream/jsonl` | 流式评估（JSON Lines / `application/x-ndjson`） |
| `GET` | `/metadata` | 门类元数据和维度信息 |

## 适配器钩子

适配器暴露 `beforeEvaluate` 生命周期钩子用于请求转换。钩子接收已验证的 `EvaluateParams`，可在调用引擎前对其进行转换 — 非常适合预处理工作流。

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
  beforeEvaluate?: (params: EvaluateParams) => Promise<EvaluateParams> | EvaluateParams;
}
```

### `EvaluateParams`

```ts
interface EvaluateParams {
  imageUrl: string;
  genre: Genre | null;
  context?: EvaluationContext;
  mode?: StreamMode;
}
```

### 钩子示例：图片预上传

将图片上传到提供商的文件 API（如 Kimi）并在评估前替换 URL：

```ts
import { createHonoAdapter } from '@theogony/venus-core/hono';

const adapter = createHonoAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params) => {
      // 上传图片到提供商文件 API
      const fileId = await uploadToFileAPI(params.imageUrl);
      return { ...params, imageUrl: fileId };
    },
  },
});
```

### 钩子示例：EXIF 注入

根据图片 URL 自动注入 EXIF 上下文：

```ts
const adapter = createExpressAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params) => {
      const exif = await fetchExifData(params.imageUrl);
      return {
        ...params,
        context: { ...params.context, exif },
      };
    },
  },
});
```

钩子在**所有端点**（`/evaluate`、`/evaluate/stream`、`/evaluate/stream/jsonl`）上触发，同时支持同步和异步实现。

## 上下文扩展

Venus 支持通过 `EvaluationContext` 传递额外上下文以增强评估准确性。上下文数据贯穿整个对抗管线 — 提案者、批判者和仲裁者 — 并在结果元数据中返回。

### EXIF 数据

将 EXIF 元数据作为一等公民传入。引擎会将 EXIF 参数按**门类感知的注入深度**格式化到智能体提示中：

```ts
const result = await engine.evaluate(
  'https://example.com/photo.jpg',
  'portrait',
  {
    exif: {
      shutterSpeed: '1/2000',
      iso: 400,
      fNumber: 2.8,
      focalLength: 85,
      cameraModel: 'SONY ILCE-7M4',
      lensModel: 'FE 85mm F1.4 GM',
      dateTimeOriginal: '2026:03:15 14:30:00',
    },
  },
);
```

### 用户备注

提供自由文本备注，让智能体了解拍摄条件或创作意图的额外上下文：

```ts
const result = await engine.evaluate(
  'https://example.com/photo.jpg',
  'landscape',
  {
    userNotes: 'Shot at sunrise with a GND graduated filter to darken the sky',
  },
);
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
console.log(result.metadata.context?.exif);      // { shutterSpeed: '1/4000', ... }
console.log(result.metadata.context?.userNotes);  // '2026 National Athletics ...'
```

### 通过 Web 框架适配器传递上下文

适配器（Hono / Express）会透明地将请求体中的 `context` 传递给引擎：

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

| 注入级别 | 门类 | 行为 |
|----------------|--------|----------|
| **高** | 体育、自然 | EXIF 参数（快门、焦距）被强调为与评估直接相关 |
| **标准** | 人像、风光 | EXIF 作为参考参数显示 |
| **轻量** | 建筑、商业、纪实 | 紧凑的单行摘要，不强调 |
| **最小** | 艺术 | 明确注明仅供参考；艺术表达优先 |

始终附加免责声明：*"EXIF 数据可能经过后期处理修改；实际视觉效果为最终评判依据。"*

## 事件系统

通过 `onEvent` 订阅管线事件：

```ts
const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  onEvent(event) {
    console.log(`[${event.type}] 轮次=${event.round} 智能体=${event.agent}`);
  },
});
```

| 事件类型 | 负载 |
|------------|---------|
| `round_start` | `{ round, agent, data }` |
| `round_complete` | `{ round }` |
| `agent_call` | `{ round, agent }` |
| `agent_complete` | `{ round, agent, data: { result, reasoning } }` |
| `error` | `{ agent, data: { error } }` |

## 参见

- [API 参考](./api-reference.md) — 所有引擎、提供商和 Schema API 的完整类型签名
- [配置参考](./configuration.md) — `VenusEngineConfig` 完整参考和推理配置
