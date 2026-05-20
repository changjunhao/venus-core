import { describe, it, expect, afterAll } from 'bun:test';
import express from 'express';
import { createExpressAdapter } from '../../src/adapters/express.js';
import { VenusError, ValidationError } from '../../src/utils/errors.js';
import { getMetadata } from '../../src/schema/index.js';
import type { VenusEngine } from '../../src/engine.js';
import type { Server } from 'node:http';
import { createMockEngine, MOCK_STREAM_EVENTS } from '../helpers/mock-adapter-engine.js';

// ── Helper: start Express on random port ───────────────

function startServer(engine: VenusEngine): Promise<{ baseUrl: string; server: Server }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/', createExpressAdapter(engine));
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ baseUrl: `http://127.0.0.1:${port}`, server });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ── Tests ──────────────────────────────────────────────

describe('Express Adapter', () => {
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(servers.map(stopServer));
  });

  async function setup(engine?: VenusEngine) {
    const { baseUrl, server } = await startServer(engine ?? createMockEngine());
    servers.push(server);
    return baseUrl;
  }

  // ── POST /evaluate — success ──
  describe('POST /evaluate', () => {
    it('should return EvaluationResult for valid request', async () => {
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate`, {
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
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(200);
    });

    // ── Validation errors ──
    it('should return 400 for invalid imageUrl', async () => {
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate`, {
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
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre: 'portrait' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for empty body', async () => {
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate`, {
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
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/metadata`, { method: 'GET' });

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
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');

      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));

      expect(lines.length).toBe(MOCK_STREAM_EVENTS.length);

      for (const line of lines) {
        const jsonStr = line.replace('data: ', '');
        const parsed = JSON.parse(jsonStr);
        expect(parsed.type).toBeTruthy();
        expect(parsed.timestamp).toBeDefined();
      }
    });

    it('should return 400 for invalid request in stream', async () => {
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate/stream`, {
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
            type: 'evaluation_start' as const,
            data: { imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' as const },
            timestamp: Date.now(),
          };
          throw new Error('Stream exploded');
        },
      });
      const baseUrl = await setup(engine);

      const res = await fetch(`${baseUrl}/evaluate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));

      const lastEvent = JSON.parse(lines[lines.length - 1]!.replace('data: ', ''));
      expect(lastEvent.type).toBe('error');
      expect(lastEvent.error.message).toBe('Stream exploded');
    });
  });

  // ── POST /evaluate/stream/jsonl — JSON Lines ──
  describe('POST /evaluate/stream/jsonl', () => {
    it('should return JSONL formatted response with correct headers', async () => {
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate/stream/jsonl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/x-ndjson');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('x-accel-buffering')).toBe('no');

      const text = await res.text();
      // Each event terminated by \n; trailing \n produces empty last segment
      const segments = text.split('\n');
      const lines = segments.filter((l) => l.length > 0);

      expect(lines.length).toBe(MOCK_STREAM_EVENTS.length);

      // Verify JSONL format: each line is valid JSON, separated by \n
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.type).toBeTruthy();
        expect(parsed.timestamp).toBeDefined();
      }

      // Verify the event sequence matches the mock
      const types = lines.map((l) => JSON.parse(l).type);
      expect(types).toEqual(MOCK_STREAM_EVENTS.map((e) => e.type));
    });

    it('should return 400 for invalid request', async () => {
      const baseUrl = await setup();

      const res = await fetch(`${baseUrl}/evaluate/stream/jsonl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'not-a-url' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should write formatted error chunk when engine stream throws', async () => {
      const engine = createMockEngine({
        evaluateStream: async function* () {
          yield {
            type: 'evaluation_start' as const,
            data: { imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' as const },
            timestamp: Date.now(),
          };
          throw new Error('JSONL stream exploded');
        },
      });
      const baseUrl = await setup(engine);

      const res = await fetch(`${baseUrl}/evaluate/stream/jsonl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/x-ndjson');

      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.length > 0);

      // Last line should be the error chunk
      const lastEvent = JSON.parse(lines[lines.length - 1]!);
      expect(lastEvent.type).toBe('error');
      expect(lastEvent.error.message).toBe('JSONL stream exploded');
      expect(lastEvent.timestamp).toBeDefined();

      // All lines should still be valid JSON terminated by \n
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  // ── Outer try/catch → next(error) path (express.ts line 81 / 112) ──
  describe('next(error) error middleware path', () => {
    /**
     * Start a server with a middleware that overrides req.body to throw on access,
     * which causes resolveStreamParams() to throw inside the outer try block,
     * triggering next(error) and the error middleware.
     */
    function startServerWithBrokenBody(engine: VenusEngine): Promise<{ baseUrl: string; server: Server }> {
      return new Promise((resolve) => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
          Object.defineProperty(req, 'body', {
            configurable: true,
            get() {
              throw new Error('req.body access failed');
            },
          });
          next();
        });
        app.use('/', createExpressAdapter(engine));
        const server = app.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          resolve({ baseUrl: `http://127.0.0.1:${port}`, server });
        });
      });
    }

    async function setupBroken(engine?: VenusEngine) {
      const { baseUrl, server } = await startServerWithBrokenBody(engine ?? createMockEngine());
      servers.push(server);
      return baseUrl;
    }

    it('should route SSE handler errors through next(error) → error middleware (line 81)', async () => {
      const baseUrl = await setupBroken();

      const res = await fetch(`${baseUrl}/evaluate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('req.body access failed');
    });

    it('should route JSONL handler errors through next(error) → error middleware', async () => {
      const baseUrl = await setupBroken();

      const res = await fetch(`${baseUrl}/evaluate/stream/jsonl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('req.body access failed');
    });

    it('should route /evaluate handler errors through next(error)', async () => {
      const baseUrl = await setupBroken();

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── Error Mapping ──
  describe('Error mapping', () => {
    it('should map ValidationError to 400', async () => {
      const engine = createMockEngine({
        evaluate: async () => {
          throw new ValidationError('Bad input');
        },
      });
      const baseUrl = await setup(engine);

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Bad input');
    });

    it('should map VenusError to 422', async () => {
      const engine = createMockEngine({
        evaluate: async () => {
          throw new VenusError('Processing failed', 'PROCESSING_ERROR');
        },
      });
      const baseUrl = await setup(engine);

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('PROCESSING_ERROR');
    });

    it('should map unknown errors to 500', async () => {
      const engine = createMockEngine({
        evaluate: async () => {
          throw new Error('Unexpected failure');
        },
      });
      const baseUrl = await setup(engine);

      const res = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/photo.jpg' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
