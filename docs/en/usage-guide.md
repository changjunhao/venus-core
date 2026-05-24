# Usage Guide

[English](./usage-guide.md) | [中文](../zh-CN/usage-guide.md)

[← Back to README](../../README.md)

## Basic Evaluation

Pass an image URL and optionally specify a genre. If omitted, the engine auto-detects the genre.

```ts
// Auto-detect genre
const result = await engine.evaluate('https://example.com/photo.jpg');

// Specify genre explicitly
const result = await engine.evaluate('https://example.com/portrait.jpg', 'portrait');
```

## Streaming Evaluation

`evaluateStream()` returns an `AsyncGenerator` that yields events at each pipeline stage — ideal for SSE or real-time UIs.

```ts
for await (const event of engine.evaluateStream('https://example.com/photo.jpg')) {
  switch (event.type) {
    case 'genre_detected':
      console.log('Genre:', event.data.genre);
      break;
    case 'agent_complete':
      console.log(`Round ${event.round} [${event.agent}] done`);
      break;
    case 'evaluation_complete':
      console.log('Final score:', event.data.totalScore);
      break;
    case 'error':
      console.error(event.error.message);
      break;
  }
}
```

### Streaming with `updates` Mode

For real-time reasoning and incremental JSON partials, use `mode: 'updates'`:

```ts
for await (const event of engine.evaluateStream('https://example.com/photo.jpg', {
  mode: 'updates',
})) {
  switch (event.type) {
    case 'reasoning_chunk':
      // Stream agent reasoning in real-time
      process.stdout.write(event.content);
      break;
    case 'result_chunk':
      // Incremental JSON — update UI progressively
      updateProgressBar(event.partial);
      break;
    case 'agent_complete':
      // Agent finished — final result available
      break;
  }
}
```

## Web Framework Integration

### Hono (recommended)

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
      // e.g., upload image to a file API, inject EXIF context
      return params;
    },
  },
}));

export default app; // Works with Bun, Deno, Node, Cloudflare Workers, etc.
```

### Express

```ts
import express from 'express';
import { createVenusEngine } from '@theogony/venus-core';
import { createExpressAdapter } from '@theogony/venus-core/express';

const engine = createVenusEngine({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.API_KEY!,
});

const app = express();
app.use(express.json());
app.use('/api', createExpressAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params) => {
      // Transform validated params before evaluation
      return params;
    },
  },
}));
app.listen(3000);
```

Both adapters expose the same endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/evaluate` | Synchronous evaluation |
| `POST` | `/evaluate/stream` | Streaming evaluation (SSE / `text/event-stream`) |
| `POST` | `/evaluate/stream/jsonl` | Streaming evaluation (JSON Lines / `application/x-ndjson`) |
| `GET` | `/metadata` | Genre metadata and dimensions |

## Adapter Hooks

Adapters expose a `beforeEvaluate` lifecycle hook for request transformation. The hook receives validated `EvaluateParams` and can transform them before the engine call — ideal for pre-processing workflows.

### `AdapterHooks`

```ts
interface AdapterHooks {
  /**
   * Called before evaluation starts (both sync and stream endpoints).
   * Receives the validated request params, can transform and return modified params.
   *
   * Use cases: upload image to provider file API, inject EXIF context,
   * override genre, switch streaming granularity, etc.
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

### Hook Example: Image Pre-Upload

Upload images to a provider's file API (e.g., Kimi) and replace the URL before evaluation:

```ts
import { createHonoAdapter } from '@theogony/venus-core/hono';

const adapter = createHonoAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params) => {
      // Upload image to provider file API
      const fileId = await uploadToFileAPI(params.imageUrl);
      return { ...params, imageUrl: fileId };
    },
  },
});
```

### Hook Example: EXIF Injection

Automatically inject EXIF context based on the image URL:

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

The hook fires on **all endpoints** (`/evaluate`, `/evaluate/stream`, `/evaluate/stream/jsonl`) and supports both sync and async implementations.

## Context Extension

Venus supports passing additional context via `EvaluationContext` to enhance evaluation accuracy. Context data flows through the entire adversarial pipeline — Proposer, Critic, and Arbiter — and is returned in the result metadata.

### EXIF Data

Pass EXIF metadata as a first-class citizen. The engine formats EXIF parameters into agent prompts with **genre-aware injection depth**:

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

### User Notes

Provide free-text notes to give agents additional context about the shooting conditions or creative intent:

```ts
const result = await engine.evaluate(
  'https://example.com/photo.jpg',
  'landscape',
  {
    userNotes: 'Shot at sunrise with a GND graduated filter to darken the sky',
  },
);
```

### Full Context Example

Combine EXIF, user notes, and custom metadata:

```ts
const result = await engine.evaluate(imageUrl, 'sports', {
  exif: { shutterSpeed: '1/4000', iso: 1600, focalLength: 400 },
  userNotes: '2026 National Athletics Championships - 100m Final',
  custom: { event: 'National Athletics Championship' },
});

// Context is returned in result metadata
console.log(result.metadata.context?.exif);      // { shutterSpeed: '1/4000', ... }
console.log(result.metadata.context?.userNotes);  // '2026 National Athletics ...'
```

### Passing Context via Web Framework Adapters

Adapters (Hono / Express) transparently pass `context` from the request body to the engine:

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

Schema validation is applied automatically: `userNotes` is limited to 2000 characters, and all EXIF fields are optional.

### Genre-Aware Injection Depth

EXIF data is injected into prompts at different intensities depending on the photography genre:

| Injection Level | Genres | Behavior |
|----------------|--------|----------|
| **High** | Sports, Nature | EXIF parameters (shutter, focal length) are emphasized as directly relevant to evaluation |
| **Standard** | Portrait, Landscape | EXIF shown as reference parameters |
| **Light** | Architecture, Commercial, Documentary | Compact one-line summary, not emphasized |
| **Minimal** | Fine Art | Explicitly noted as reference only; artistic expression takes priority |

A disclaimer is always appended: *"EXIF data may have been modified in post-processing; the actual visual result is the final basis for evaluation."*

## Event System

Subscribe to pipeline events via `onEvent`:

```ts
const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  onEvent(event) {
    console.log(`[${event.type}] round=${event.round} agent=${event.agent}`);
  },
});
```

| Event Type | Payload |
|------------|---------|
| `round_start` | `{ round, agent, data }` |
| `round_complete` | `{ round }` |
| `agent_call` | `{ round, agent }` |
| `agent_complete` | `{ round, agent, data: { result, reasoning } }` |
| `error` | `{ agent, data: { error } }` |

## See Also

- [API Reference](./api-reference.md) — Complete type signatures for all engine, provider, and schema APIs
- [Configuration](./configuration.md) — `VenusEngineConfig` full reference and reasoning configuration
