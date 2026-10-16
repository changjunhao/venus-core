# Usage Guide

[English](./usage-guide.md) | [中文](../zh-CN/usage-guide.md)

[← Back to README](../../README.md)

## Basic Evaluation

The examples below assume an engine configured as in the [Quick Start](../../README.md#quick-start). Set `defaultModel` on the engine (or supply per-agent `models`); a provider's `defaultModel` does not configure the engine.

Pass an image URL and optionally specify a genre. If omitted, the engine auto-detects the genre.

```ts
// Auto-detect genre
const result1 = await engine.evaluate('https://example.com/photo.jpg');

// Specify genre explicitly
const result2 = await engine.evaluate('https://example.com/portrait.jpg', 'portrait');
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

## Group Evaluation

`evaluateGroup()` evaluates **2 to 10 images at once** through the same adversarial pipeline. The group mode is the second positional argument:

| Mode      | Use it for                               | Key result fields                                                                                |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `joint`   | A series / photo essay judged as a whole | `sceneType`, `totalScore`, `dimensions`, `groupAnalysis`, `critique`, `suggestions`              |
| `compare` | Ranking the images against each other    | `ranking` (per image: `index`, `rank`, `score`, `rationale`), `comparisonSummary`, `suggestions` |

```ts
const imageUrls = [
  'https://example.com/wedding-01.jpg',
  'https://example.com/wedding-02.jpg',
  'https://example.com/wedding-03.jpg',
];

// Joint evaluation — the group as one body of work
const joint = await engine.evaluateGroup(imageUrls, 'joint', { genre: 'portrait' });
if (joint.mode === 'joint') {
  console.log(joint.totalScore); // 8.4
  console.log(joint.groupAnalysis); // narrative / consistency analysis of the series
}

// Compare evaluation — rank the images against each other
const compare = await engine.evaluateGroup(imageUrls, 'compare');
if (compare.mode === 'compare') {
  for (const item of compare.ranking) {
    console.log(`#${item.rank} → image ${item.index} (${item.score}): ${item.rationale}`);
  }
}
```

The return type is the `GroupEvaluationResult` union, so TypeScript requires narrowing on `mode` before reading mode-specific fields such as `totalScore`, `groupAnalysis` or `ranking`. Fields shared by both modes — `imageUrls`, `mode`, `genre`, `suggestions`, `arbitrationNotes`, `perImage`, `process`, `metadata` — are accessible without a guard.

Fewer than 2 or more than 10 URLs throws `ValidationError`. `index` in `ranking` (and in `perImage`) is the 0-based position in the input `imageUrls` array.

### Per-Image Details (`includePerImage`)

`includePerImage` defaults to `false`. It is enforced at **both the prompt and the JSON Schema layer**: when disabled, the prompts do not ask for per-image output and the schema has no `per_image` field, so the model never generates those tokens. Enable it only when you actually need the extra detail:

```ts
const result = await engine.evaluateGroup(imageUrls, 'joint', { includePerImage: true });

result.perImage?.forEach((item) => {
  console.log(`image ${item.index}: ${item.score} — ${item.comment}`);
});
console.log(result.metadata.includePerImage); // true
```

> Tip: prefer public HTTP(S) URLs over `data:` base64 URLs for groups — providers that accept URLs pass them straight through, avoiding base64 payload inflation across all rounds.

### Streaming Group Evaluation

```ts
for await (const event of engine.evaluateGroupStream(imageUrls, 'compare', {
  mode: 'updates', // streaming granularity, independent of the group mode above
})) {
  switch (event.type) {
    case 'group_evaluation_start':
      console.log(`Evaluating ${event.data.imageUrls.length} images (${event.data.mode})`);
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

Event order: round-0 `agent_call` / `agent_complete` + `genre_detected` (only when the genre is auto-detected) → `group_evaluation_start` → per-round `agent_call` / `agent_complete` → `group_evaluation_complete`. Non-cancellation errors — including an image count outside 2–10 — surface as a final `error` event. Signal cancellation instead rejects iteration with `AbortError`; see [End-to-End Cancellation](#end-to-end-cancellation).

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
  defaultModel: '<your-model>',
});

const app = new Hono();
app.route(
  '/api',
  createHonoAdapter(engine, {
    hooks: {
      beforeEvaluate: async (params) => {
        // e.g., upload image to a file API, inject EXIF context
        return params;
      },
    },
  }),
);

export default app; // Works with Bun, Deno, Node, Cloudflare Workers, etc.
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
        // Transform validated params before evaluation
        return params;
      },
    },
  }),
);
app.listen(3000);
```

### Nitro (h3)

```ts
// server/routes/api/[...].ts (Nuxt / Nitro server route)
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
      // Transform validated params before evaluation
      return params;
    },
  },
});

export default useBase('/api', venus.handler);
```

All three adapters expose the same endpoints:

| Method | Path                           | Description                                                      |
| ------ | ------------------------------ | ---------------------------------------------------------------- |
| `POST` | `/evaluate`                    | Synchronous evaluation                                           |
| `POST` | `/evaluate/stream`             | Streaming evaluation (SSE / `text/event-stream`)                 |
| `POST` | `/evaluate/stream/jsonl`       | Streaming evaluation (JSON Lines / `application/x-ndjson`)       |
| `POST` | `/evaluate/group`              | Synchronous group evaluation (2–10 images)                       |
| `POST` | `/evaluate/group/stream`       | Streaming group evaluation (SSE / `text/event-stream`)           |
| `POST` | `/evaluate/group/stream/jsonl` | Streaming group evaluation (JSON Lines / `application/x-ndjson`) |
| `GET`  | `/metadata`                    | Genre metadata and dimensions                                    |

### Group Evaluation Endpoints

All three group endpoints accept the same JSON body:

| Field             | Type                    | Required | Description                                                            |
| ----------------- | ----------------------- | -------- | ---------------------------------------------------------------------- |
| `imageUrls`       | `string[]`              | yes      | 2–10 image URLs; private/reserved hosts are rejected (SSRF protection) |
| `mode`            | `'joint' \| 'compare'`  | yes      | **Group evaluation mode**                                              |
| `genre`           | `Genre`                 | no       | Pre-specified genre; auto-detected if omitted                          |
| `context`         | `EvaluationContext`     | no       | EXIF data, user notes, custom metadata                                 |
| `includePerImage` | `boolean`               | no       | Request per-image details (default `false`)                            |
| `streamMode`      | `'values' \| 'updates'` | no       | **Streaming granularity**, stream endpoints only (default `values`)    |

**`mode` vs `streamMode`** — the group endpoints carry two independent switches:

| Field        | Values               | Meaning                                                                                       | SDK equivalent                                                         |
| ------------ | -------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `mode`       | `joint` / `compare`  | _What_ is evaluated: the group as a whole vs. images against each other                       | 2nd positional argument of `evaluateGroup()` / `evaluateGroupStream()` |
| `streamMode` | `values` / `updates` | _How finely_ events are emitted (milestones only vs. plus `reasoning_chunk` / `result_chunk`) | `options.mode` of `evaluateGroupStream()`                              |

> On the single-image endpoints the granularity field is called `mode` (there is no evaluation mode there). The group endpoints rename it to `streamMode` so that `mode` can carry `joint` / `compare`.

Synchronous group evaluation:

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

`joint` response (abridged):

```json
{
  "imageUrls": ["https://example.com/wedding-01.jpg", "https://example.com/wedding-02.jpg"],
  "mode": "joint",
  "genre": "portrait",
  "sceneType": "wedding",
  "totalScore": 8.4,
  "dimensions": { "facial_expression": 8.5, "pose_body": 8.0, "lighting_quality": 8.5 },
  "groupAnalysis": "The two frames form a coherent narrative ...",
  "critique": "...",
  "suggestions": ["Simplify the background to keep attention on the subject"],
  "arbitrationNotes": {
    "sceneTypeRuling": "The images are wedding portraits",
    "decisions": [
      { "target": "lighting_quality", "decision": "partial", "reason": "Light control varies between frames" }
    ],
    "finalRationale": "The final assessment balances expression and light control"
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

`compare` response (abridged) — same request with `"mode": "compare"`:

```json
{
  "imageUrls": ["https://example.com/wedding-01.jpg", "https://example.com/wedding-02.jpg"],
  "mode": "compare",
  "genre": "portrait",
  "ranking": [
    { "index": 1, "rank": 1, "score": 8.5, "rationale": "Stronger light and cleaner background" },
    { "index": 0, "rank": 2, "score": 7.5, "rationale": "Flatter expression, busier frame" }
  ],
  "comparisonSummary": "The second frame leads on light control ...",
  "suggestions": ["Simplify the background to keep attention on the subject"],
  "arbitrationNotes": {
    "sceneTypeRuling": "The images are wedding portraits",
    "decisions": [
      { "target": "lighting_quality", "decision": "partial", "reason": "Light control varies between frames" }
    ],
    "finalRationale": "The final assessment balances expression and light control"
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

Validation failures return `400` with `{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }` — fewer than 2 or more than 10 URLs, a missing/unknown `mode`, an unknown `genre`, or any URL pointing at a private/reserved host.

Streaming group evaluation over SSE:

```bash
curl -N -X POST http://localhost:3000/api/evaluate/group/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "imageUrls": ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    "mode": "compare",
    "streamMode": "updates"
  }'
```

Each event is a `data:` line terminated by a blank line (abridged events below; some intermediate events and result fields are omitted):

```text
data: {"type":"agent_call","round":0,"agent":"genreDetector","timestamp":1785000000000}

data: {"type":"genre_detected","data":{"genre":"portrait","reasoning":null},"timestamp":1785000000100}

data: {"type":"group_evaluation_start","data":{"imageUrls":["https://example.com/a.jpg","https://example.com/b.jpg"],"mode":"compare","genre":"portrait"},"timestamp":1785000000200}

data: {"type":"agent_call","round":1,"agent":"proposer","timestamp":1785000000300}

data: {"type":"reasoning_chunk","agent":"proposer","content":"Comparing the two frames ...","timestamp":1785000000400}

data: {"type":"agent_complete","round":1,"agent":"proposer","data":{"result":{},"reasoning":null},"timestamp":1785000012000}

data: {"type":"group_evaluation_complete","data":{"mode":"compare","ranking":[]},"timestamp":1785000040000}
```

The JSONL endpoint emits the very same events, one compact JSON object per line (no `data:` prefix) with `Content-Type: application/x-ndjson`:

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

On both stream endpoints a non-cancellation failure is appended as a final `error` event, and the HTTP status stays `200` because the headers are already sent. Cancellation or client disconnect stops writing without an error or synthetic completion frame. A cancellation before headers may map to HTTP `499 ABORTED` if a response is still possible; disconnected clients should not expect to receive it.

## Adapter Hooks

Adapters expose a `beforeEvaluate` lifecycle hook for request transformation. The hook receives validated `EvaluateParams` and can transform them before the engine call — ideal for pre-processing workflows. Group endpoints have their own `beforeEvaluateGroup` counterpart.

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
  beforeEvaluate?: (params: EvaluateParams, context?: CancellationOptions) => Promise<EvaluateParams> | EvaluateParams;

  /**
   * Called before a group evaluation starts (both sync and stream endpoints).
   * Receives the validated group request params, can transform and return modified params.
   */
  beforeEvaluateGroup?: (
    params: GroupEvaluateParams,
    context?: CancellationOptions,
  ) => Promise<GroupEvaluateParams> | GroupEvaluateParams;
}
```

The optional second argument contains `signal`; existing one-argument hooks remain compatible. This execution context is separate from `params.context` (EXIF/user metadata). Forward the signal to your upload, metadata, or other I/O helpers. These application-defined helpers must pass it to their underlying `fetch`/SDK calls; adding an unused parameter does not cancel I/O.

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

### Hook Example: Image Pre-Upload

Upload images to a provider's file API (e.g., Kimi) and replace the URL before evaluation:

```ts
import { createHonoAdapter } from '@theogony/venus-core/hono';

const adapter = createHonoAdapter(engine, {
  hooks: {
    beforeEvaluate: async (params, context) => {
      // Return an image URL supported by the selected provider
      const imageUrl = await uploadToFileAPI(params.imageUrl, { signal: context?.signal });
      return { ...params, imageUrl };
    },
  },
});
```

### Hook Example: EXIF Injection

Automatically inject EXIF context based on the image URL:

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

The hook fires on **all single-image endpoints** (`/evaluate`, `/evaluate/stream`, `/evaluate/stream/jsonl`) and supports both sync and async implementations.

### Hook Example: Group Pre-Processing

`beforeEvaluateGroup` fires on **all three group endpoints** (`/evaluate/group`, `/evaluate/group/stream`, `/evaluate/group/stream/jsonl`) and can rewrite every field of `GroupEvaluateParams`:

```ts
const adapter = createHonoAdapter(engine, {
  hooks: {
    beforeEvaluateGroup: async (params, context) => {
      // Upload each image and force per-image details for premium tenants
      const imageUrls = await Promise.all(
        params.imageUrls.map((url) => uploadToFileAPI(url, { signal: context?.signal })),
      );
      return { ...params, imageUrls, includePerImage: true };
    },
  },
});
```

`beforeEvaluate` and `beforeEvaluateGroup` are independent: single-image requests never trigger the group hook, and vice versa.

## Context Extension

Venus supports passing additional context via `EvaluationContext` to enhance evaluation accuracy. Context data flows through the entire adversarial pipeline — Proposer, Critic, and Arbiter — and is returned in the result metadata.

### EXIF Data

Pass EXIF metadata as a first-class citizen. The engine formats EXIF parameters into agent prompts with **genre-aware injection depth**:

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

### User Notes

Provide free-text notes to give agents additional context about the shooting conditions or creative intent:

```ts
const result = await engine.evaluate('https://example.com/photo.jpg', 'landscape', {
  userNotes: 'Shot at sunrise with a GND graduated filter to darken the sky',
});
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
console.log(result.metadata.context?.exif); // { shutterSpeed: '1/4000', ... }
console.log(result.metadata.context?.userNotes); // '2026 National Athletics ...'
```

### Passing Context via Web Framework Adapters

Adapters (Hono / Express / Nitro) transparently pass `context` from the request body to the engine:

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

| Injection Level | Genres                                | Behavior                                                                                  |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| **High**        | Sports, Nature                        | EXIF parameters (shutter, focal length) are emphasized as directly relevant to evaluation |
| **Standard**    | Portrait, Landscape                   | EXIF shown as reference parameters                                                        |
| **Light**       | Architecture, Commercial, Documentary | Compact one-line summary, not emphasized                                                  |
| **Minimal**     | Fine Art                              | Explicitly noted as reference only; artistic expression takes priority                    |

A disclaimer is always appended: _"EXIF data may have been modified in post-processing; the actual visual result is the final basis for evaluation."_

## Event System

Subscribe to pipeline events via `onEvent`:

```ts
const engine = createVenusEngine({
  provider: createOpenAIChatProvider({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.API_KEY!,
  }),
  defaultModel: '<your-model>',
  onEvent(event) {
    console.log(`[${event.type}] round=${event.round} agent=${event.agent}`);
  },
});
```

| Event Type       | Payload                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `round_start`    | `{ round, agent, data }`                                                  |
| `round_complete` | `{ round }`                                                               |
| `agent_call`     | `{ round, agent }`                                                        |
| `agent_complete` | `{ round, agent, data: { result, reasoning } }`                           |
| `error`          | `{ agent, data: { error } }`                                              |
| `cancelled`      | `{ agent: 'engine', data: { code: 'ABORTED' } }` (at most once per scope) |

`onEvent` observes all four single-image/group entry points. Every observation includes `timestamp`; stream events are delivered separately through the iterator. `cancelled` is only an observation event, not a stream frame. It is emitted at most once for an active evaluation, not for pre-aborted calls or cancellation during a hook before the engine starts.

## End-to-End Cancellation

All four entry points support per-request cancellation. Use a fresh controller or timeout signal for each independent request; an aborted signal cannot be reset. See the [API reference](./api-reference.md#end-to-end-cancellation) for signatures and the behavior matrix.

### Non-Streaming Evaluation

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

Call `controller.abort()` from a cancel action to stop early. When only a deadline is needed, pass `AbortSignal.timeout(ms)` instead; the engine reports it as `AbortError`, not the SDK's `TimeoutError` class.

### Streaming and Early Exit

```ts
import { isAbortError } from '@theogony/venus-core';

try {
  for await (const event of engine.evaluateStream(imageUrl, {
    mode: 'updates',
    signal: AbortSignal.timeout(30_000),
  })) {
    console.log(event);
    if (event.type === 'agent_complete') break; // Stop after the first agent
  }
} catch (error) {
  if (!isAbortError(error)) throw error;
}
```

`for await` calls the iterator's `return()` on `break`, cancelling unfinished work without requiring a separate controller. Signal cancellation rejects iteration once with `AbortError`, then subsequent reads return `done`. No `error`, `evaluation_complete`, or `group_evaluation_complete` is synthesized. If you manually drive an iterator, call `await stream.return()` in `finally` and handle any pending `next()` rejection.

### Group Evaluation

The signal belongs in the third argument; group mode and streaming granularity remain separate:

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

For a separate streaming request:

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

### HTTP Client Cancellation

Pass `signal` to `fetch`, not the JSON request body. This browser example works with the SSE endpoint; JSONL and group endpoints use the same cancellation mechanism:

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
    console.log(value); // Raw bytes; decode and parse SSE/JSONL in your application
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally {
  clearTimeout(timer);
  if (reader) {
    // Cleanup must not replace a read error if the stream is already aborted
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
```

Wire a cancel action to `controller.abort()`. Cancelling the response reader also stops consumption and signals disconnect through the transport. Hono uses `Request.signal` and response-stream cancellation; Express uses Node request/response events; Nitro selects the Web or Node mechanism. Your runtime and reverse proxy must forward disconnects for cancellation to reach the adapter.

Notes:

- **Custom providers / hooks** must forward `params.signal` / the hook's second argument `context?.signal` to actual I/O. Otherwise the engine only stops waiting, stops further scheduling, and discards late results.
- **Revision round** receives the signal even when routed to a dedicated `revision` provider.
- **Concurrency** — requests sharing an engine/provider remain independent unless the caller deliberately shares a signal. Returning one stream does not abort its parent's signal or sibling requests.
- **Server-side tasks** — local requests are aborted, but vendor-side generation and billing are outside SDK guarantees.

## See Also

- [API Reference](./api-reference.md) — Complete type signatures for all engine, provider, and schema APIs
- [Configuration](./configuration.md) — `VenusEngineConfig` full reference and reasoning configuration
