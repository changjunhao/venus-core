// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect, afterAll } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import { createExpressAdapter } from '../../src/adapters/express.js';
import type { VenusEngine } from '../../src/engine.js';
import type { AdapterHooks, GroupEvaluateOptions, GroupEvaluationMode } from '../../src/types.js';
import {
  createMockEngine,
  MOCK_GROUP_IMAGE_URLS,
  MOCK_GROUP_JOINT_RESULT,
  MOCK_GROUP_STREAM_EVENTS,
} from '../helpers/mock-adapter-engine.js';

// ── Helpers: start Express on random port ──────────────

function startServer(
  engine: VenusEngine,
  options?: { prefix?: string; hooks?: AdapterHooks },
): Promise<{ baseUrl: string; server: Server }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/', createExpressAdapter(engine, options));
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

function postJSON(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Build an engine that records the arguments passed to evaluateGroup */
function createRecordingEngine() {
  const calls: Array<{ imageUrls: string[]; mode: GroupEvaluationMode; options?: GroupEvaluateOptions }> = [];
  const engine = createMockEngine({
    evaluateGroup: (async (imageUrls: string[], mode: GroupEvaluationMode, options?: GroupEvaluateOptions) => {
      calls.push({ imageUrls, mode, options });
      return { ...MOCK_GROUP_JOINT_RESULT, imageUrls, mode } as any;
    }) as VenusEngine['evaluateGroup'],
  });
  return { engine, calls };
}

const TWO_URLS = MOCK_GROUP_IMAGE_URLS;
const ELEVEN_URLS = Array.from({ length: 11 }, (_, i) => `https://example.com/photo-${i}.jpg`);

// ── Tests ──────────────────────────────────────────────

describe('Express Adapter — group evaluation', () => {
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(servers.map(stopServer));
  });

  async function setup(engine?: VenusEngine, options?: { prefix?: string; hooks?: AdapterHooks }) {
    const { baseUrl, server } = await startServer(engine ?? createMockEngine(), options);
    servers.push(server);
    return baseUrl;
  }

  // ── POST /evaluate/group — success ──
  describe('POST /evaluate/group', () => {
    it('should return a joint GroupEvaluationResult', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.mode).toBe('joint');
      expect(body.imageUrls).toEqual(TWO_URLS);
      expect(body.genre).toBe('portrait');
      expect(body.totalScore).toBe(8);
      expect(body.groupAnalysis).toBeDefined();
      expect(body.metadata.imageCount).toBe(2);
    });

    it('should return a compare GroupEvaluationResult with ranking', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'compare' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.mode).toBe('compare');
      expect(body.imageUrls).toEqual(TWO_URLS);
      expect(body.ranking).toBeInstanceOf(Array);
      expect(body.ranking.length).toBe(2);
      expect(body.comparisonSummary).toBeDefined();
    });

    // ── Validation errors ──
    it('should return 400 when imageUrls has fewer than 2 entries', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', {
        imageUrls: ['https://example.com/photo-1.jpg'],
        mode: 'joint',
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when imageUrls has more than 10 entries', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', { imageUrls: ELEVEN_URLS, mode: 'joint' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when any imageUrl targets a private host (SSRF)', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', {
        imageUrls: ['https://example.com/photo-1.jpg', 'http://169.254.169.254/latest/meta-data'],
        mode: 'joint',
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('private or reserved host');
    });

    it('should return 400 when mode is missing', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', { imageUrls: TWO_URLS });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when mode is not joint/compare', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'ranking' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for an invalid genre', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        genre: 'invalid_genre',
      });

      expect(res.status).toBe(400);
    });

    // ── Parameter passthrough ──
    it('should forward includePerImage to engine.evaluateGroup', async () => {
      const { engine, calls } = createRecordingEngine();
      const baseUrl = await setup(engine);

      const res = await postJSON(baseUrl, '/evaluate/group', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        includePerImage: true,
      });

      expect(res.status).toBe(200);
      expect(calls.length).toBe(1);
      expect(calls[0]!.options?.includePerImage).toBe(true);
    });

    it('should leave includePerImage undefined when omitted (engine default applies)', async () => {
      const { engine, calls } = createRecordingEngine();
      const baseUrl = await setup(engine);

      const res = await postJSON(baseUrl, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'compare' });

      expect(res.status).toBe(200);
      expect(calls[0]!.mode).toBe('compare');
      expect(calls[0]!.options?.includePerImage).toBeUndefined();
    });

    it('should forward genre as null when omitted and pass context through', async () => {
      const { engine, calls } = createRecordingEngine();
      const baseUrl = await setup(engine);

      const res = await postJSON(baseUrl, '/evaluate/group', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        context: { userNotes: 'A wedding series' },
      });

      expect(res.status).toBe(200);
      expect(calls[0]!.options?.genre).toBeNull();
      expect(calls[0]!.options?.context).toEqual({ userNotes: 'A wedding series' });
    });
  });

  // ── beforeEvaluateGroup hook ──
  describe('beforeEvaluateGroup hook', () => {
    it('should apply rewritten imageUrls and genre before calling the engine', async () => {
      const { engine, calls } = createRecordingEngine();
      const hooks: AdapterHooks = {
        beforeEvaluateGroup: (params) => ({
          ...params,
          imageUrls: ['https://hooked.example.com/a.jpg', 'https://hooked.example.com/b.jpg'],
          genre: 'landscape',
        }),
      };
      const baseUrl = await setup(engine, { hooks });

      const res = await postJSON(baseUrl, '/evaluate/group', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(calls[0]!.imageUrls).toEqual([
        'https://hooked.example.com/a.jpg',
        'https://hooked.example.com/b.jpg',
      ]);
      expect(calls[0]!.options?.genre).toBe('landscape');
    });

    it('should support an async hook that flips includePerImage', async () => {
      const { engine, calls } = createRecordingEngine();
      const hooks: AdapterHooks = {
        beforeEvaluateGroup: async (params) => {
          await new Promise((r) => setTimeout(r, 5));
          return { ...params, includePerImage: true };
        },
      };
      const baseUrl = await setup(engine, { hooks });

      const res = await postJSON(baseUrl, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      expect(calls[0]!.options?.includePerImage).toBe(true);
    });

    it('should apply the hook on the SSE group stream route', async () => {
      let received: string[] = [];
      const engine = createMockEngine({
        evaluateGroupStream: async function* (imageUrls, mode) {
          received = imageUrls;
          yield {
            type: 'group_evaluation_start',
            data: { imageUrls, mode, genre: 'portrait' as const },
            timestamp: Date.now(),
          };
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluateGroup: (params) => ({
          ...params,
          imageUrls: ['https://hooked-sse.example.com/a.jpg', 'https://hooked-sse.example.com/b.jpg'],
        }),
      };
      const baseUrl = await setup(engine, { hooks });

      const res = await postJSON(baseUrl, '/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      await res.text();
      expect(received).toEqual(['https://hooked-sse.example.com/a.jpg', 'https://hooked-sse.example.com/b.jpg']);
    });
  });

  // ── POST /evaluate/group/stream — SSE ──
  describe('POST /evaluate/group/stream', () => {
    it('should return SSE formatted group events', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group/stream', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');

      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
      expect(lines.length).toBe(MOCK_GROUP_STREAM_EVENTS.length);

      const types = lines.map((l) => JSON.parse(l.replace('data: ', '')).type);
      expect(types[0]).toBe('group_evaluation_start');
      expect(types).toContain('group_evaluation_complete');

      for (const line of lines) {
        const parsed = JSON.parse(line.replace('data: ', ''));
        expect(parsed.type).toBeTruthy();
        expect(parsed.timestamp).toBeDefined();
      }
    });

    it('should forward mode and streamMode separately to the engine', async () => {
      let receivedMode: GroupEvaluationMode | undefined;
      let receivedStreamMode: string | undefined;
      const engine = createMockEngine({
        evaluateGroupStream: async function* (imageUrls, mode, options) {
          receivedMode = mode;
          receivedStreamMode = options?.mode;
          yield {
            type: 'group_evaluation_start',
            data: { imageUrls, mode, genre: 'portrait' as const },
            timestamp: Date.now(),
          };
        },
      });
      const baseUrl = await setup(engine);

      const res = await postJSON(baseUrl, '/evaluate/group/stream', {
        imageUrls: TWO_URLS,
        mode: 'compare',
        streamMode: 'updates',
      });

      expect(res.status).toBe(200);
      await res.text();
      expect(receivedMode).toBe('compare');
      expect(receivedStreamMode).toBe('updates');
    });

    it('should return 400 for an invalid group stream request', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'nope' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should write an error event when the group stream throws mid-flight', async () => {
      const engine = createMockEngine({
        evaluateGroupStream: async function* (imageUrls, mode) {
          yield {
            type: 'group_evaluation_start',
            data: { imageUrls, mode, genre: 'portrait' as const },
            timestamp: Date.now(),
          };
          throw new Error('Group stream exploded');
        },
      });
      const baseUrl = await setup(engine);

      const res = await postJSON(baseUrl, '/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));

      const lastEvent = JSON.parse(lines[lines.length - 1]!.replace('data: ', ''));
      expect(lastEvent.type).toBe('error');
      expect(lastEvent.error.message).toBe('Group stream exploded');
    });
  });

  // ── POST /evaluate/group/stream/jsonl — JSON Lines ──
  describe('POST /evaluate/group/stream/jsonl', () => {
    it('should return JSONL formatted group events with correct headers', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group/stream/jsonl', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/x-ndjson');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('x-accel-buffering')).toBe('no');

      const text = await res.text();
      expect(text.includes('data: ')).toBe(false);

      const lines = text.split('\n').filter((l) => l.length > 0);
      expect(lines.map((l) => JSON.parse(l).type)).toEqual(MOCK_GROUP_STREAM_EVENTS.map((e) => e.type));
    });

    it('should return 400 for an invalid group JSONL request', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/group/stream/jsonl', {
        imageUrls: ['not-a-url', 'https://example.com/photo-2.jpg'],
        mode: 'joint',
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should append an error line when the group stream throws mid-flight', async () => {
      const engine = createMockEngine({
        evaluateGroupStream: async function* (imageUrls, mode) {
          yield {
            type: 'group_evaluation_start',
            data: { imageUrls, mode, genre: 'portrait' as const },
            timestamp: Date.now(),
          };
          throw new Error('Group JSONL stream exploded');
        },
      });
      const baseUrl = await setup(engine);

      const res = await postJSON(baseUrl, '/evaluate/group/stream/jsonl', { imageUrls: TWO_URLS, mode: 'compare' });

      expect(res.status).toBe(200);
      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.length > 0);

      expect(lines.length).toBe(2);
      const last = JSON.parse(lines[lines.length - 1]!);
      expect(last.type).toBe('error');
      expect(last.error.message).toBe('Group JSONL stream exploded');
    });
  });

  // ── prefix option ──
  describe('prefix option', () => {
    it('should mount all group routes under the configured prefix', async () => {
      const baseUrl = await setup(createMockEngine(), { prefix: '/api' });

      const res = await postJSON(baseUrl, '/api/evaluate/group', { imageUrls: TWO_URLS, mode: 'joint' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).mode).toBe('joint');

      const sse = await postJSON(baseUrl, '/api/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'joint' });
      expect(sse.status).toBe(200);
      expect(sse.headers.get('content-type')).toContain('text/event-stream');
      await sse.text();

      const jsonl = await postJSON(baseUrl, '/api/evaluate/group/stream/jsonl', {
        imageUrls: TWO_URLS,
        mode: 'joint',
      });
      expect(jsonl.status).toBe(200);
      expect(jsonl.headers.get('content-type')).toContain('application/x-ndjson');
      await jsonl.text();

      // Unprefixed path must not resolve
      const missing = await postJSON(baseUrl, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'joint' });
      expect(missing.status).toBe(404);
    });
  });

  // ── Regression: single-image routes unaffected ──
  describe('single-image route regression', () => {
    it('should keep POST /evaluate working on the same router', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.totalScore).toBe(7.5);
      expect(body.imageUrls).toBeUndefined();
    });

    it('should keep POST /evaluate/stream working on the same router', async () => {
      const baseUrl = await setup();

      const res = await postJSON(baseUrl, '/evaluate/stream', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(200);
      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
      expect(JSON.parse(lines[0]!.replace('data: ', '')).type).toBe('evaluation_start');
    });
  });
});
