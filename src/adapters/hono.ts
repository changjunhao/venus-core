// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Hono Adapter
 *
 * Creates Hono routes for the evaluation API (Web Standards, cross-runtime).
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { createVenusEngine } from '@theogony/venus-core';
 * import { createHonoAdapter } from '@theogony/venus-core/hono';
 *
 * const engine = createVenusEngine({ baseURL: '...', apiKey: '...' });
 * const venus = createHonoAdapter(engine);
 * const app = new Hono();
 * app.route('/api', venus);
 * ```
 */

import { Hono } from 'hono';
import type { VenusEngine } from '../engine.js';
import type { AdapterOptions } from '../types.js';
import {
  mapErrorToResponse,
  handleEvaluate,
  handleMetadata,
  resolveStreamParams,
  formatSSEError,
  formatJSONLError,
} from './common.js';

export function createHonoAdapter(engine: VenusEngine, options?: AdapterOptions): Hono {
  const app = new Hono();
  const prefix = options?.prefix ?? '';

  // POST /evaluate
  app.post(`${prefix}/evaluate`, async (c) => {
    try {
      const body = await c.req.json();
      const result = await handleEvaluate(engine, body);
      if (!result.ok) {
        return c.json(result.body, result.status);
      }
      return c.json(result.data);
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return c.json(body, status);
    }
  });

  // GET /metadata
  app.get(`${prefix}/metadata`, (c) => {
    return c.json(handleMetadata());
  });

  // POST /evaluate/stream (SSE)
  app.post(`${prefix}/evaluate/stream`, async (c) => {
    try {
      const body = await c.req.json();
      const parsed = resolveStreamParams(body);
      if (!parsed.ok) {
        return c.json(parsed.body, parsed.status);
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            try {
              for await (const event of engine.evaluateStream(imageUrl, { genre: genre ?? null, context, mode })) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }
            } catch (err) {
              controller.enqueue(encoder.encode(formatSSEError(err)));
            } finally {
              controller.close();
            }
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        },
      );
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return c.json(body, status);
    }
  });

  // POST /evaluate/stream/jsonl (Streamable HTTP - JSON Lines)
  app.post(`${prefix}/evaluate/stream/jsonl`, async (c) => {
    try {
      const body = await c.req.json();
      const parsed = resolveStreamParams(body);
      if (!parsed.ok) {
        return c.json(parsed.body, parsed.status);
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            try {
              for await (const event of engine.evaluateStream(imageUrl, { genre: genre ?? null, context, mode })) {
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              }
            } catch (err) {
              controller.enqueue(encoder.encode(formatJSONLError(err)));
            } finally {
              controller.close();
            }
          },
        }),
        {
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        },
      );
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return c.json(body, status);
    }
  });

  return app;
}
