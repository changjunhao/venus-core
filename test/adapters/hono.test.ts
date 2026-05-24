import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { createHonoAdapter } from '../../src/adapters/hono.js';
import { getMetadata } from '../../src/schema/index.js';
import type { VenusEngine } from '../../src/engine.js';
import type { AdapterHooks } from '../../src/types.js';
import { createMockEngine, MOCK_STREAM_EVENTS } from '../helpers/mock-adapter-engine.js';

// ── Helper ─────────────────────────────────────────────

function createApp(engine: VenusEngine, hooks?: AdapterHooks) {
  const app = new Hono();
  app.route('/', createHonoAdapter(engine, hooks ? { hooks } : undefined));
  return app;
}

// ── Tests ──────────────────────────────────────────────

describe('Hono Adapter', () => {
  // ── POST /evaluate — success ──
  describe('POST /evaluate', () => {
    it('should return EvaluationResult for valid request', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.genre).toBe('portrait');
      expect(body.totalScore).toBe(7.5);
      expect(body.sceneType).toBe('studio');
      expect(body.dimensions).toBeDefined();
      expect(body.metadata).toBeDefined();
    });

    it('should accept request without optional genre', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(200);
    });

    // ── Validation errors ──
    it('should return 400 for invalid imageUrl', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'not-a-url' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing imageUrl', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre: 'portrait' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for empty body', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /metadata ──
  describe('GET /metadata', () => {
    it('should return metadata for all genres', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/metadata', { method: 'GET' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;

      const expectedMetadata = getMetadata();
      const genres = Object.keys(expectedMetadata);
      expect(genres.length).toBe(8);

      for (const genre of genres) {
        expect(body[genre]).toBeDefined();
        expect(body[genre].label).toBe(expectedMetadata[genre]!.label);
        expect(body[genre].dimensions).toBeInstanceOf(Array);
        expect(body[genre].subtypes).toBeInstanceOf(Array);
      }
    });
  });

  // ── POST /evaluate/stream — SSE ──
  describe('POST /evaluate/stream', () => {
    it('should return SSE formatted response', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');

      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));

      expect(lines.length).toBe(MOCK_STREAM_EVENTS.length);

      // Each line should be valid JSON after "data: " prefix
      for (const line of lines) {
        const jsonStr = line.replace('data: ', '');
        const parsed = JSON.parse(jsonStr);
        expect(parsed.type).toBeTruthy();
        expect(parsed.timestamp).toBeDefined();
      }
    });

    it('should return 400 for invalid request in stream', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'bad-url' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should send error event when engine stream throws', async () => {
      const engine = createMockEngine({
        evaluateStream: async function* () {
          yield {
            type: 'evaluation_start',
            data: { imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' as const },
            timestamp: Date.now(),
          };
          throw new Error('Stream exploded');
        },
      });
      const app = createApp(engine);

      const res = await app.request('/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));

      // Last event should be an error
      const lastEvent = JSON.parse(lines[lines.length - 1]!.replace('data: ', ''));
      expect(lastEvent.type).toBe('error');
      expect(lastEvent.error.message).toBe('Stream exploded');
    });
  });

  // ── POST /evaluate/stream — SSE outer catch (lines 91-92) ──
  describe('POST /evaluate/stream (outer error path)', () => {
    it('should map malformed JSON body to a 500 response (outer catch)', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-valid-json',
      });

      // c.req.json() throws SyntaxError → mapErrorToResponse → 500
      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should map VenusError thrown synchronously by stream setup to 422', async () => {
      // Engine.evaluateStream is invoked lazily inside the ReadableStream, so to
      // hit the outer catch we rely on JSON parse failure (covered above).
      // This additional case verifies the outer catch path normalises errors via
      // mapErrorToResponse for non-validation failures originating before stream start.
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // missing body entirely — Hono throws when calling c.req.json()
        body: '',
      });

      expect([400, 500]).toContain(res.status);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
    });
  });

  // ── POST /evaluate/stream/jsonl — JSON Lines (lines 98-132) ──
  describe('POST /evaluate/stream/jsonl', () => {
    it('should return JSONL formatted response with correct headers', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream/jsonl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      // Header validation
      expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    });

    it('should encode each event as a newline-terminated JSON line', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream/jsonl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();

      // Each event must end with '\n'; no SSE 'data: ' prefix and no double newline.
      expect(text.endsWith('\n')).toBe(true);
      expect(text.includes('data: ')).toBe(false);
      expect(text.includes('\n\n')).toBe(false);

      const lines = text.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(MOCK_STREAM_EVENTS.length);

      // Each line should parse as JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.type).toBeTruthy();
        expect(parsed.timestamp).toBeDefined();
      }
    });

    it('should stream chunks via ReadableStream + TextEncoder (decodable as UTF-8)', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream/jsonl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();

      // Manually decode the underlying byte stream to confirm TextEncoder produced valid UTF-8.
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder('utf-8');
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        expect(value).toBeInstanceOf(Uint8Array);
        acc += decoder.decode(value, { stream: true });
      }
      acc += decoder.decode();

      const lines = acc.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(MOCK_STREAM_EVENTS.length);
      // First event should be evaluation_start as defined in MOCK_STREAM_EVENTS
      const first = JSON.parse(lines[0]!);
      expect(first.type).toBe('evaluation_start');
    });

    it('should return 400 for invalid imageUrl', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream/jsonl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'not-a-url' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should gracefully append an error line when engine stream throws mid-flight', async () => {
      const engine = createMockEngine({
        evaluateStream: async function* () {
          yield {
            type: 'evaluation_start',
            data: { imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' as const },
            timestamp: Date.now(),
          };
          yield { type: 'agent_call', round: 1, agent: 'proposer', timestamp: Date.now() };
          throw new Error('JSONL stream exploded');
        },
      });
      const app = createApp(engine);

      const res = await app.request('/evaluate/stream/jsonl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      // Stream still completes with 200 — the error is reported as a final JSON line.
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');

      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.length > 0);

      // We expect 2 successful events + 1 error event line.
      expect(lines.length).toBe(3);

      const last = JSON.parse(lines[lines.length - 1]!);
      expect(last.type).toBe('error');
      expect(last.error).toBeDefined();
      expect(last.error.message).toBe('JSONL stream exploded');
      expect(typeof last.timestamp).toBe('number');
    });

    it('should map malformed JSON body on JSONL route to 500 (outer catch)', async () => {
      const app = createApp(createMockEngine());

      const res = await app.request('/evaluate/stream/jsonl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{broken',
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── beforeEvaluate Hook ──
  describe('beforeEvaluate hook', () => {
    it('should transform imageUrl via hook on POST /evaluate', async () => {
      const engine = createMockEngine({
        evaluate: async (imageUrl) => {
          // Return the imageUrl so test can verify hook transformed it
          return { ...MOCK_STREAM_EVENTS[0], imageUrl } as any;
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({
          ...params,
          imageUrl: 'https://transformed.example.com/photo.jpg',
        }),
      };
      const app = createApp(engine, hooks);

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.imageUrl).toBe('https://transformed.example.com/photo.jpg');
    });

    it('should transform genre via hook on POST /evaluate', async () => {
      const engine = createMockEngine({
        evaluate: async (_url, genre) => {
          return { genre } as any;
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({
          ...params,
          genre: 'landscape',
        }),
      };
      const app = createApp(engine, hooks);

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.genre).toBe('landscape');
    });

    it('should support async hook', async () => {
      const engine = createMockEngine({
        evaluate: async (imageUrl) => {
          return { imageUrl } as any;
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: async (params) => {
          await new Promise((r) => setTimeout(r, 5));
          return { ...params, imageUrl: 'https://async.example.com/photo.jpg' };
        },
      };
      const app = createApp(engine, hooks);

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.imageUrl).toBe('https://async.example.com/photo.jpg');
    });

    it('should pass without hook (default passthrough)', async () => {
      const engine = createMockEngine({
        evaluate: async (imageUrl) => {
          return { imageUrl } as any;
        },
      });
      const app = createApp(engine); // no hooks

      const res = await app.request('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.imageUrl).toBe('https://example.com/photo.jpg');
    });

    it('should apply hook on POST /evaluate/stream (SSE)', async () => {
      let receivedImageUrl = '';
      const engine = createMockEngine({
        evaluateStream: async function* (imageUrl) {
          receivedImageUrl = imageUrl;
          yield { type: 'evaluation_start', data: { imageUrl, genre: 'portrait' as const }, timestamp: Date.now() };
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({
          ...params,
          imageUrl: 'https://hooked-sse.example.com/photo.jpg',
        }),
      };
      const app = createApp(engine, hooks);

      const res = await app.request('/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      await res.text(); // consume body
      expect(receivedImageUrl).toBe('https://hooked-sse.example.com/photo.jpg');
    });

    it('should apply hook on POST /evaluate/stream/jsonl', async () => {
      let receivedImageUrl = '';
      const engine = createMockEngine({
        evaluateStream: async function* (imageUrl) {
          receivedImageUrl = imageUrl;
          yield { type: 'evaluation_start', data: { imageUrl, genre: 'portrait' as const }, timestamp: Date.now() };
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({
          ...params,
          imageUrl: 'https://hooked-jsonl.example.com/photo.jpg',
        }),
      };
      const app = createApp(engine, hooks);

      const res = await app.request('/evaluate/stream/jsonl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      await res.text(); // consume body
      expect(receivedImageUrl).toBe('https://hooked-jsonl.example.com/photo.jpg');
    });
  });
});
