// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { createApp, toWebHandler } from 'h3';
import { createNitroAdapter } from '../../src/adapters/nitro.js';
import { getMetadata } from '../../src/schema/index.js';
import { VenusError } from '../../src/utils/errors.js';
import type { VenusEngine } from '../../src/engine.js';
import type { AdapterHooks, GroupEvaluateOptions, GroupEvaluationMode } from '../../src/types.js';
import {
  createMockEngine,
  MOCK_GROUP_IMAGE_URLS,
  MOCK_GROUP_JOINT_RESULT,
  MOCK_GROUP_STREAM_EVENTS,
  MOCK_STREAM_EVENTS,
} from '../helpers/mock-adapter-engine.js';

// ── Helpers ────────────────────────────────────────────

type WebHandler = ReturnType<typeof toWebHandler>;

/** Mount the Nitro (h3) router on a bare h3 app and expose it as a fetch-style handler */
function createTestHandler(engine: VenusEngine, options?: { prefix?: string; hooks?: AdapterHooks }): WebHandler {
  const app = createApp();
  app.use(createNitroAdapter(engine, options));
  return toWebHandler(app);
}

function postJSON(handler: WebHandler, path: string, body: unknown) {
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** POST an unparsed raw string body (used for malformed-JSON paths) */
function postRaw(handler: WebHandler, path: string, raw: string) {
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    }),
  );
}

function getPath(handler: WebHandler, path: string) {
  return handler(new Request(`http://localhost${path}`, { method: 'GET' }));
}

/** Split an SSE payload into its `data: ` frames */
function sseFrames(text: string): string[] {
  return text.split('\n\n').filter((l) => l.startsWith('data: '));
}

function parseSSE(frame: string): any {
  return JSON.parse(frame.replace('data: ', ''));
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

describe('Nitro Adapter', () => {
  // ── POST /evaluate ──
  describe('POST /evaluate', () => {
    it('should return EvaluationResult for valid request', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      const body = (await res.json()) as any;
      expect(body.genre).toBe('portrait');
      expect(body.totalScore).toBe(7.5);
      expect(body.sceneType).toBe('studio');
      expect(body.dimensions).toBeDefined();
      expect(body.metadata).toBeDefined();
    });

    it('should accept request without optional genre', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(200);
    });

    // ── Validation errors ──
    it('should return 400 for invalid imageUrl', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'not-a-url' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing imageUrl', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate', { genre: 'portrait' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for empty body', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate', {});

      expect(res.status).toBe(400);
    });

    it('should return 400 when imageUrl targets a private host (SSRF)', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'http://127.0.0.1/secret.jpg' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('private or reserved host');
    });

    // ── Engine errors ──
    it('should return 422 when the engine throws a VenusError', async () => {
      const engine = createMockEngine({
        evaluate: async () => {
          throw new VenusError('Provider refused the image', 'PROVIDER_ERROR');
        },
      });
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(422);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('PROVIDER_ERROR');
      expect(body.error.message).toBe('Provider refused the image');
    });

    it('should return 500 when the engine throws an unexpected error', async () => {
      const engine = createMockEngine({
        evaluate: async () => {
          throw new Error('Engine exploded');
        },
      });
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Engine exploded');
    });

    it('should map a malformed JSON body to 500 (outer catch)', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postRaw(handler, '/evaluate', '{not-valid-json');

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── GET /metadata ──
  describe('GET /metadata', () => {
    it('should return metadata for all genres', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await getPath(handler, '/metadata');

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
    it('should return SSE formatted response with streaming headers', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/stream', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('Connection')).toBe('keep-alive');

      const text = await res.text();
      const frames = sseFrames(text);
      expect(frames.length).toBe(MOCK_STREAM_EVENTS.length);

      // Each frame must be `data: {json}\n\n`
      for (const frame of frames) {
        const parsed = parseSSE(frame);
        expect(parsed.type).toBeTruthy();
        expect(parsed.timestamp).toBeDefined();
      }
      expect(parseSSE(frames[0]!).type).toBe('evaluation_start');
    });

    it('should return 400 for an invalid request before the stream starts', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/stream', { imageUrl: 'bad-url' });

      expect(res.status).toBe(400);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should send an error event when the engine stream throws', async () => {
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
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate/stream', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      const frames = sseFrames(await res.text());
      expect(frames.length).toBe(2);

      const lastEvent = parseSSE(frames[frames.length - 1]!);
      expect(lastEvent.type).toBe('error');
      expect(lastEvent.error.message).toBe('Stream exploded');
      expect(typeof lastEvent.timestamp).toBe('number');
    });

    it('should map a malformed JSON body to 500 (outer catch)', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postRaw(handler, '/evaluate/stream', '{not-valid-json');

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── POST /evaluate/stream/jsonl — JSON Lines ──
  describe('POST /evaluate/stream/jsonl', () => {
    it('should return JSONL formatted response with correct headers', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/stream/jsonl', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('Connection')).toBe('keep-alive');
      expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    });

    it('should encode each event as a newline-terminated JSON line', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/stream/jsonl', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      const text = await res.text();

      // Each event ends with '\n'; no SSE 'data: ' prefix and no blank separator line.
      expect(text.endsWith('\n')).toBe(true);
      expect(text.includes('data: ')).toBe(false);
      expect(text.includes('\n\n')).toBe(false);

      const lines = text.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(MOCK_STREAM_EVENTS.length);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.type).toBeTruthy();
        expect(parsed.timestamp).toBeDefined();
      }
    });

    it('should stream chunks decodable as UTF-8 bytes', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/stream/jsonl', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();

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
      expect(JSON.parse(lines[0]!).type).toBe('evaluation_start');
    });

    it('should return 400 for invalid imageUrl', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/stream/jsonl', { imageUrl: 'not-a-url' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should append an error line when the engine stream throws mid-flight', async () => {
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
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate/stream/jsonl', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      // Stream still completes with 200 — the failure is reported as a final JSON line.
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');

      const lines = (await res.text()).split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(3);

      const last = JSON.parse(lines[lines.length - 1]!);
      expect(last.type).toBe('error');
      expect(last.error.message).toBe('JSONL stream exploded');
      expect(typeof last.timestamp).toBe('number');
    });

    it('should map a malformed JSON body on the JSONL route to 500', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postRaw(handler, '/evaluate/stream/jsonl', '{broken');

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── POST /evaluate/group ──
  describe('POST /evaluate/group', () => {
    it('should return a joint GroupEvaluationResult', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group', {
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
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'compare' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.mode).toBe('compare');
      expect(body.ranking).toBeInstanceOf(Array);
      expect(body.ranking.length).toBe(2);
      expect(body.comparisonSummary).toBeDefined();
    });

    // ── Validation errors ──
    it('should return 400 when imageUrls has fewer than 2 entries', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group', {
        imageUrls: ['https://example.com/photo-1.jpg'],
        mode: 'joint',
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when imageUrls has more than 10 entries', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group', { imageUrls: ELEVEN_URLS, mode: 'joint' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when mode is not joint/compare', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'ranking' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when any imageUrl targets a private host (SSRF)', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group', {
        imageUrls: ['https://example.com/photo-1.jpg', 'http://192.168.0.5/secret.jpg'],
        mode: 'joint',
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.message).toContain('private or reserved host');
    });

    it('should forward includePerImage, genre and context to the engine', async () => {
      const { engine, calls } = createRecordingEngine();
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate/group', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        includePerImage: true,
        context: { userNotes: 'A wedding series' },
      });

      expect(res.status).toBe(200);
      expect(calls.length).toBe(1);
      expect(calls[0]!.mode).toBe('joint');
      expect(calls[0]!.options?.includePerImage).toBe(true);
      expect(calls[0]!.options?.genre).toBeNull();
      expect(calls[0]!.options?.context).toEqual({ userNotes: 'A wedding series' });
    });

    it('should return 422 when the engine throws a VenusError', async () => {
      const engine = createMockEngine({
        evaluateGroup: async () => {
          throw new VenusError('Group evaluation failed', 'SCHEMA_ERROR');
        },
      });
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(422);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('SCHEMA_ERROR');
    });
  });

  // ── POST /evaluate/group/stream — SSE ──
  describe('POST /evaluate/group/stream', () => {
    it('should return SSE formatted group events with streaming headers', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group/stream', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('Connection')).toBe('keep-alive');

      const frames = sseFrames(await res.text());
      expect(frames.length).toBe(MOCK_GROUP_STREAM_EVENTS.length);

      const types = frames.map((f) => parseSSE(f).type);
      expect(types[0]).toBe('group_evaluation_start');
      expect(types).toContain('group_evaluation_complete');
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
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate/group/stream', {
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
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'nope' });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should send an error event when the group stream throws mid-flight', async () => {
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
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      const frames = sseFrames(await res.text());
      const lastEvent = parseSSE(frames[frames.length - 1]!);
      expect(lastEvent.type).toBe('error');
      expect(lastEvent.error.message).toBe('Group stream exploded');
    });

    it('should map a malformed JSON body to 500 (outer catch)', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postRaw(handler, '/evaluate/group/stream', '{not-valid-json');

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── POST /evaluate/group/stream/jsonl — JSON Lines ──
  describe('POST /evaluate/group/stream/jsonl', () => {
    it('should return JSONL formatted group events with correct headers', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group/stream/jsonl', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('X-Accel-Buffering')).toBe('no');

      const text = await res.text();
      expect(text.endsWith('\n')).toBe(true);
      expect(text.includes('data: ')).toBe(false);

      const lines = text.split('\n').filter((l) => l.length > 0);
      expect(lines.map((l) => JSON.parse(l).type)).toEqual(MOCK_GROUP_STREAM_EVENTS.map((e) => e.type));
    });

    it('should return 400 for an invalid group JSONL request', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postJSON(handler, '/evaluate/group/stream/jsonl', {
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
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate/group/stream/jsonl', { imageUrls: TWO_URLS, mode: 'compare' });

      expect(res.status).toBe(200);
      const lines = (await res.text()).split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(2);

      const last = JSON.parse(lines[lines.length - 1]!);
      expect(last.type).toBe('error');
      expect(last.error.message).toBe('Group JSONL stream exploded');
    });

    it('should map a malformed JSON body on the group JSONL route to 500', async () => {
      const handler = createTestHandler(createMockEngine());

      const res = await postRaw(handler, '/evaluate/group/stream/jsonl', '{broken');

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── beforeEvaluate hook ──
  describe('beforeEvaluate hook', () => {
    it('should transform imageUrl before calling the engine', async () => {
      const engine = createMockEngine({
        evaluate: async (imageUrl) => ({ imageUrl }) as any,
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({ ...params, imageUrl: 'https://transformed.example.com/photo.jpg' }),
      };
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(200);
      expect(((await res.json()) as any).imageUrl).toBe('https://transformed.example.com/photo.jpg');
    });

    it('should transform genre before calling the engine', async () => {
      const engine = createMockEngine({
        evaluate: async (_url, genre) => ({ genre }) as any,
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({ ...params, genre: 'landscape' }),
      };
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate', {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(((await res.json()) as any).genre).toBe('landscape');
    });

    it('should support an async hook', async () => {
      const engine = createMockEngine({
        evaluate: async (imageUrl) => ({ imageUrl }) as any,
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: async (params) => {
          await new Promise((r) => setTimeout(r, 5));
          return { ...params, imageUrl: 'https://async.example.com/photo.jpg' };
        },
      };
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(200);
      expect(((await res.json()) as any).imageUrl).toBe('https://async.example.com/photo.jpg');
    });

    it('should pass params through unchanged without a hook', async () => {
      const engine = createMockEngine({
        evaluate: async (imageUrl) => ({ imageUrl }) as any,
      });
      const handler = createTestHandler(engine);

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(200);
      expect(((await res.json()) as any).imageUrl).toBe('https://example.com/photo.jpg');
    });

    it('should apply the hook on the SSE stream route', async () => {
      let receivedImageUrl = '';
      const engine = createMockEngine({
        evaluateStream: async function* (imageUrl) {
          receivedImageUrl = imageUrl;
          yield {
            type: 'evaluation_start',
            data: { imageUrl, genre: 'portrait' as const },
            timestamp: Date.now(),
          };
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({ ...params, imageUrl: 'https://hooked-sse.example.com/photo.jpg' }),
      };
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate/stream', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(200);
      await res.text();
      expect(receivedImageUrl).toBe('https://hooked-sse.example.com/photo.jpg');
    });

    it('should apply the hook on the JSONL stream route', async () => {
      let receivedImageUrl = '';
      const engine = createMockEngine({
        evaluateStream: async function* (imageUrl) {
          receivedImageUrl = imageUrl;
          yield {
            type: 'evaluation_start',
            data: { imageUrl, genre: 'portrait' as const },
            timestamp: Date.now(),
          };
        },
      });
      const hooks: AdapterHooks = {
        beforeEvaluate: (params) => ({ ...params, imageUrl: 'https://hooked-jsonl.example.com/photo.jpg' }),
      };
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate/stream/jsonl', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(200);
      await res.text();
      expect(receivedImageUrl).toBe('https://hooked-jsonl.example.com/photo.jpg');
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
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate/group', {
        imageUrls: TWO_URLS,
        mode: 'joint',
        genre: 'portrait',
      });

      expect(res.status).toBe(200);
      expect(calls[0]!.imageUrls).toEqual(['https://hooked.example.com/a.jpg', 'https://hooked.example.com/b.jpg']);
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
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate/group', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      expect(calls[0]!.options?.includePerImage).toBe(true);
    });

    it('should apply the hook on the group SSE stream route', async () => {
      let received: string[] = [];
      const engine = createMockEngine({
        evaluateGroupStream: async function* (imageUrls) {
          received = imageUrls;
          yield {
            type: 'group_evaluation_start',
            data: { imageUrls, mode: 'joint' as const, genre: 'portrait' as const },
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
      const handler = createTestHandler(engine, { hooks });

      const res = await postJSON(handler, '/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'joint' });

      expect(res.status).toBe(200);
      await res.text();
      expect(received).toEqual(['https://hooked-sse.example.com/a.jpg', 'https://hooked-sse.example.com/b.jpg']);
    });
  });

  // ── prefix option ──
  describe('prefix option', () => {
    it('should mount every route under the configured prefix', async () => {
      const handler = createTestHandler(createMockEngine(), { prefix: '/api' });

      const single = await postJSON(handler, '/api/evaluate', { imageUrl: 'https://example.com/photo.jpg' });
      expect(single.status).toBe(200);
      expect(((await single.json()) as any).totalScore).toBe(7.5);

      const metadata = await getPath(handler, '/api/metadata');
      expect(metadata.status).toBe(200);

      const sse = await postJSON(handler, '/api/evaluate/stream', { imageUrl: 'https://example.com/photo.jpg' });
      expect(sse.status).toBe(200);
      expect(sse.headers.get('Content-Type')).toBe('text/event-stream');
      await sse.text();

      const jsonl = await postJSON(handler, '/api/evaluate/stream/jsonl', {
        imageUrl: 'https://example.com/photo.jpg',
      });
      expect(jsonl.status).toBe(200);
      expect(jsonl.headers.get('Content-Type')).toBe('application/x-ndjson');
      await jsonl.text();

      const group = await postJSON(handler, '/api/evaluate/group', { imageUrls: TWO_URLS, mode: 'joint' });
      expect(group.status).toBe(200);
      expect(((await group.json()) as any).mode).toBe('joint');

      const groupSse = await postJSON(handler, '/api/evaluate/group/stream', { imageUrls: TWO_URLS, mode: 'joint' });
      expect(groupSse.status).toBe(200);
      expect(groupSse.headers.get('Content-Type')).toBe('text/event-stream');
      await groupSse.text();

      const groupJsonl = await postJSON(handler, '/api/evaluate/group/stream/jsonl', {
        imageUrls: TWO_URLS,
        mode: 'joint',
      });
      expect(groupJsonl.status).toBe(200);
      expect(groupJsonl.headers.get('Content-Type')).toBe('application/x-ndjson');
      await groupJsonl.text();
    });

    it('should not resolve unprefixed paths when a prefix is configured', async () => {
      const handler = createTestHandler(createMockEngine(), { prefix: '/api' });

      const res = await postJSON(handler, '/evaluate', { imageUrl: 'https://example.com/photo.jpg' });

      expect(res.status).toBe(404);
    });
  });
});
