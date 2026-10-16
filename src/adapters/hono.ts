// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Hono Adapter
 *
 * Creates Hono routes for the evaluation API (Web Standards, cross-runtime).
 *
 * @module
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { createVenusEngine, createOpenAIChatProvider } from '@theogony/venus-core';
 * import { createHonoAdapter } from '@theogony/venus-core/hono';
 *
 * const engine = createVenusEngine({
 *   provider: createOpenAIChatProvider({ baseURL: '...', apiKey: '...' }),
 * });
 * const venus = createHonoAdapter(engine);
 * const app = new Hono();
 * app.route('/api', venus);
 * ```
 */

import { Hono } from 'hono';
import { awaitWithSignal, createCancellationScope } from '../utils/cancellation.js';
import { streamHeaders, webEventStream } from './streaming.js';
import type { VenusEngine } from '../engine.js';
import type { AdapterOptions } from '../types.js';
import {
  mapErrorToResponse,
  handleEvaluate,
  handleMetadata,
  handleGroupEvaluate,
  resolveStreamParamsWithHook,
  resolveGroupStreamParamsWithHook,
} from './common.js';

export function createHonoAdapter(engine: VenusEngine, options?: AdapterOptions): Hono {
  const app = new Hono();
  const prefix = options?.prefix ?? '';
  const hooks = options?.hooks;

  // POST /evaluate
  app.post(`${prefix}/evaluate`, async (c) => {
    const scope = createCancellationScope(c.req.raw.signal);
    try {
      const body = await awaitWithSignal(() => c.req.json(), scope.signal);
      const result = await handleEvaluate(engine, body, hooks, scope);
      if (!result.ok) {
        return c.json(result.body, result.status);
      }
      return c.json(result.data);
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return status === 499 ? Response.json(body, { status }) : c.json(body, status);
    } finally {
      scope.dispose();
    }
  });

  // GET /metadata
  app.get(`${prefix}/metadata`, (c) => {
    return c.json(handleMetadata());
  });

  // POST /evaluate/stream (SSE)
  app.post(`${prefix}/evaluate/stream`, async (c) => {
    const scope = createCancellationScope(c.req.raw.signal);
    let transferred = false;
    try {
      const body = await awaitWithSignal(() => c.req.json(), scope.signal);
      const parsed = await resolveStreamParamsWithHook(body, hooks, scope);
      if (!parsed.ok) {
        return c.json(parsed.body, parsed.status);
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      const response = new Response(
        webEventStream(engine.evaluateStream(imageUrl, { genre, context, mode, signal: scope.signal }), scope, 'sse'),
        { headers: streamHeaders('sse') },
      );
      transferred = true;
      return response;
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return status === 499 ? Response.json(body, { status }) : c.json(body, status);
    } finally {
      if (!transferred) scope.dispose();
    }
  });

  // POST /evaluate/stream/jsonl (Streamable HTTP - JSON Lines)
  app.post(`${prefix}/evaluate/stream/jsonl`, async (c) => {
    const scope = createCancellationScope(c.req.raw.signal);
    let transferred = false;
    try {
      const body = await awaitWithSignal(() => c.req.json(), scope.signal);
      const parsed = await resolveStreamParamsWithHook(body, hooks, scope);
      if (!parsed.ok) {
        return c.json(parsed.body, parsed.status);
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      const response = new Response(
        webEventStream(engine.evaluateStream(imageUrl, { genre, context, mode, signal: scope.signal }), scope, 'jsonl'),
        { headers: streamHeaders('jsonl') },
      );
      transferred = true;
      return response;
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return status === 499 ? Response.json(body, { status }) : c.json(body, status);
    } finally {
      if (!transferred) scope.dispose();
    }
  });

  // POST /evaluate/group
  app.post(`${prefix}/evaluate/group`, async (c) => {
    const scope = createCancellationScope(c.req.raw.signal);
    try {
      const body = await awaitWithSignal(() => c.req.json(), scope.signal);
      const result = await handleGroupEvaluate(engine, body, hooks, scope);
      if (!result.ok) {
        return c.json(result.body, result.status);
      }
      return c.json(result.data);
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return status === 499 ? Response.json(body, { status }) : c.json(body, status);
    } finally {
      scope.dispose();
    }
  });

  // POST /evaluate/group/stream (SSE)
  app.post(`${prefix}/evaluate/group/stream`, async (c) => {
    const scope = createCancellationScope(c.req.raw.signal);
    let transferred = false;
    try {
      const body = await awaitWithSignal(() => c.req.json(), scope.signal);
      const parsed = await resolveGroupStreamParamsWithHook(body, hooks, scope);
      if (!parsed.ok) {
        return c.json(parsed.body, parsed.status);
      }
      const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

      const response = new Response(
        webEventStream(
          engine.evaluateGroupStream(imageUrls, mode, {
            genre,
            context,
            includePerImage,
            mode: streamMode,
            signal: scope.signal,
          }),
          scope,
          'sse',
        ),
        { headers: streamHeaders('sse') },
      );
      transferred = true;
      return response;
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return status === 499 ? Response.json(body, { status }) : c.json(body, status);
    } finally {
      if (!transferred) scope.dispose();
    }
  });

  // POST /evaluate/group/stream/jsonl (Streamable HTTP - JSON Lines)
  app.post(`${prefix}/evaluate/group/stream/jsonl`, async (c) => {
    const scope = createCancellationScope(c.req.raw.signal);
    let transferred = false;
    try {
      const body = await awaitWithSignal(() => c.req.json(), scope.signal);
      const parsed = await resolveGroupStreamParamsWithHook(body, hooks, scope);
      if (!parsed.ok) {
        return c.json(parsed.body, parsed.status);
      }
      const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

      const response = new Response(
        webEventStream(
          engine.evaluateGroupStream(imageUrls, mode, {
            genre,
            context,
            includePerImage,
            mode: streamMode,
            signal: scope.signal,
          }),
          scope,
          'jsonl',
        ),
        { headers: streamHeaders('jsonl') },
      );
      transferred = true;
      return response;
    } catch (error) {
      const { status, body } = mapErrorToResponse(error);
      return status === 499 ? Response.json(body, { status }) : c.json(body, status);
    } finally {
      if (!transferred) scope.dispose();
    }
  });

  return app;
}
