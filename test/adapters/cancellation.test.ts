// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { createApp, toWebHandler } from 'h3';
import express from 'express';
import { Hono } from 'hono';
import type { Server } from 'node:http';
import { createExpressAdapter } from '../../src/adapters/express.js';
import { createHonoAdapter } from '../../src/adapters/hono.js';
import { createNitroAdapter } from '../../src/adapters/nitro.js';
import { AbortError } from '../../src/utils/errors.js';
import type { AdapterOptions } from '../../src/types.js';
import type { VenusEngine } from '../../src/engine.js';
import { createMockEngine } from '../helpers/mock-adapter-engine.js';
import { deferred, watchdog } from '../helpers/cancellation.js';

/** 观察 engine.evaluate/Stream 收到的 signal；nextSignal 首次 push 时 resolve。 */
function observeEngine() {
  const signals: AbortSignal[] = [];
  const waiters: Array<(s: AbortSignal) => void> = [];
  const pushSignal = (s: AbortSignal) => {
    signals.push(s);
    const w = waiters.shift();
    if (w) w(s);
  };
  const nextSignal = () =>
    signals.length > 0
      ? Promise.resolve(signals[signals.length - 1]!)
      : new Promise<AbortSignal>((resolve) => waiters.push(resolve));
  const gate = deferred<void>();
  const engine = {
    evaluate: async (_u: string, _g: unknown, _c: unknown, options?: { signal?: AbortSignal }) => {
      if (options?.signal) pushSignal(options.signal);
      await gate.promise;
      throw new AbortError();
    },
    evaluateStream: async function* (_u: string, options?: { signal?: AbortSignal }) {
      if (options?.signal) pushSignal(options.signal);
      yield { type: 'evaluation_start', data: { imageUrl: _u, genre: 'portrait' }, timestamp: Date.now() };
      await gate.promise;
    },
    evaluateGroup: async (_u: string[], _m: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) pushSignal(options.signal);
      await gate.promise;
      throw new AbortError();
    },
    evaluateGroupStream: async function* (_u: string[], _m: string, options?: { signal?: AbortSignal }) {
      if (options?.signal) pushSignal(options.signal);
      yield {
        type: 'group_evaluation_start',
        data: { imageUrls: _u, mode: 'joint', genre: 'portrait' },
        timestamp: Date.now(),
      };
      await gate.promise;
    },
  } as unknown as VenusEngine;
  const onceAborted = (s: AbortSignal) =>
    s.aborted || new Promise<boolean>((r) => s.addEventListener('abort', () => r(true), { once: true }));
  return { engine, signals, nextSignal, onceAborted };
}

async function withExpress(
  engine: VenusEngine,
  options?: AdapterOptions,
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/', createExpressAdapter(engine, options));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

describe('Express Adapter 取消接线', () => {
  it('POST /evaluate 客户端断开触发 engine 收到 abort', async () => {
    const { engine, signals, nextSignal, onceAborted } = observeEngine();
    const { url, close } = await withExpress(engine);
    try {
      const controller = new AbortController();
      const pending = fetch(`${url}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/p.jpg', genre: 'portrait' }),
        signal: controller.signal,
      });
      const signal = await watchdog(nextSignal());
      expect(signals.length).toBe(1);
      controller.abort();
      await pending.catch(() => undefined);
      expect(await watchdog(Promise.resolve(onceAborted(signal)))).toBe(true);
    } finally {
      await close();
    }
  });

  it('POST /evaluate/stream reader.cancel 中止 engine', async () => {
    const { engine, signals, nextSignal, onceAborted } = observeEngine();
    const { url, close } = await withExpress(engine);
    try {
      const res = await fetch(`${url}/evaluate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/p.jpg', genre: 'portrait' }),
      });
      const reader = res.body!.getReader();
      const signalPromise = nextSignal();
      const read = reader.read();
      const signal = await watchdog(signalPromise);
      await read.catch(() => undefined);
      expect(signals.length).toBe(1);
      await reader.cancel('user disconnect');
      expect(await watchdog(Promise.resolve(onceAborted(signal)))).toBe(true);
    } finally {
      await close();
    }
  });
});

describe('Hono Adapter 取消接线', () => {
  it('c.req.raw.signal 传递给 engine', async () => {
    const { engine, signals, nextSignal, onceAborted } = observeEngine();
    const app = new Hono();
    app.route('/', createHonoAdapter(engine));
    const controller = new AbortController();
    const pending = Promise.resolve(
      app.fetch(
        new Request('http://localhost/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: 'https://example.com/p.jpg', genre: 'portrait' }),
          signal: controller.signal,
        }),
      ),
    );
    const signal = await watchdog(nextSignal());
    expect(signals.length).toBe(1);
    controller.abort();
    await pending.catch(() => undefined);
    expect(await watchdog(Promise.resolve(onceAborted(signal)))).toBe(true);
  });

  it('reader.cancel 中止 engine stream', async () => {
    const { engine, signals, nextSignal, onceAborted } = observeEngine();
    const app = new Hono();
    app.route('/', createHonoAdapter(engine));
    const res = await app.fetch(
      new Request('http://localhost/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/p.jpg', genre: 'portrait' }),
      }),
    );
    const reader = res.body!.getReader();
    const signalPromise = nextSignal();
    const read = reader.read();
    const signal = await watchdog(signalPromise);
    await read.catch(() => undefined);
    expect(signals.length).toBe(1);
    await reader.cancel();
    expect(await watchdog(Promise.resolve(onceAborted(signal)))).toBe(true);
  });
});

describe('Nitro Adapter 取消接线', () => {
  function mount(engine: VenusEngine) {
    const app = createApp();
    app.use(createNitroAdapter(engine));
    return toWebHandler(app);
  }

  it('web 路径下 Request.signal 传递到 engine', async () => {
    const { engine, signals, nextSignal, onceAborted } = observeEngine();
    const handler = mount(engine);
    const controller = new AbortController();
    const pending = Promise.resolve(
      handler(
        new Request('http://localhost/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: 'https://example.com/p.jpg', genre: 'portrait' }),
          signal: controller.signal,
        }),
      ),
    );
    const signal = await watchdog(nextSignal());
    expect(signals.length).toBe(1);
    controller.abort();
    await pending.catch(() => undefined);
    expect(await watchdog(Promise.resolve(onceAborted(signal)))).toBe(true);
  });

  it('reader.cancel 中止 engine stream', async () => {
    const { engine, nextSignal, onceAborted } = observeEngine();
    const handler = mount(engine);
    const res = await handler(
      new Request('http://localhost/evaluate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/p.jpg', genre: 'portrait' }),
      }),
    );
    const reader = res.body!.getReader();
    const signalPromise = nextSignal();
    const read = reader.read();
    const signal = await watchdog(signalPromise);
    await read.catch(() => undefined);
    await reader.cancel();
    expect(await watchdog(Promise.resolve(onceAborted(signal)))).toBe(true);
  });
});

describe('beforeEvaluate hook 取消', () => {
  it('hook 中被 abort → 不再调用 engine', async () => {
    let engineCalls = 0;
    const engine = createMockEngine({
      evaluate: (async () => {
        engineCalls++;
        return {};
      }) as unknown as VenusEngine['evaluate'],
    });
    const controller = new AbortController();
    const hono = new Hono();
    hono.route(
      '/',
      createHonoAdapter(engine, {
        hooks: {
          beforeEvaluate: async (params) => {
            controller.abort();
            // 未响应 signal 的 hook 也应被外层 awaitWithSignal 打断
            return params;
          },
        },
      }),
    );
    const res = await hono.fetch(
      new Request('http://localhost/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'https://example.com/p.jpg', genre: 'portrait' }),
        signal: controller.signal,
      }),
    );
    expect(res.status).toBe(499);
    expect(engineCalls).toBe(0);
  });
});
