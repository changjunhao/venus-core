// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Nitro (h3) Adapter
 *
 * Creates an h3 router for the evaluation API, usable in Nitro / Nuxt server routes.
 *
 * @module
 * @example
 * ```ts
 * // server/routes/api/[...].ts
 * import { createVenusEngine, createOpenAIChatProvider } from '@theogony/venus-core';
 * import { createNitroAdapter } from '@theogony/venus-core/nitro';
 * import { useBase } from 'h3';
 *
 * const engine = createVenusEngine({
 *   provider: createOpenAIChatProvider({ baseURL: '...', apiKey: '...' }),
 * });
 * const venus = createNitroAdapter(engine);
 *
 * export default useBase('/api', venus.handler);
 * ```
 */

import { createRouter, defineEventHandler, readBody } from 'h3';
import type { Router, H3Event } from 'h3';
import { awaitWithSignal, createCancellationScope, type CancellationScope } from '../utils/cancellation.js';
import { nodeRequestScope, streamHeaders, webEventStream, writeNodeStream, type StreamFormat } from './streaming.js';
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

/** Build a JSON error response with an explicit status code */
function jsonError(status: number, body: { error: { code: string; message: string } }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestScope(event: H3Event): CancellationScope {
  if (event.web?.request) return createCancellationScope(event.web.request.signal);
  return event.node.res.socket ? nodeRequestScope(event.node.req, event.node.res) : createCancellationScope();
}

async function sendEvaluationStream(
  event: H3Event,
  iterator: AsyncIterator<unknown>,
  scope: CancellationScope,
  format: StreamFormat,
) {
  if (!event.web?.request && event.node.res.socket) {
    await writeNodeStream(event.node.res, iterator, scope, format);
    return;
  }
  return new Response(webEventStream(iterator, scope, format), { headers: streamHeaders(format) });
}

export function createNitroAdapter(engine: VenusEngine, options?: AdapterOptions): Router {
  const router = createRouter();
  const prefix = options?.prefix ?? '';
  const hooks = options?.hooks;

  // POST /evaluate
  router.post(
    `${prefix}/evaluate`,
    defineEventHandler(async (event) => {
      const scope = requestScope(event);
      try {
        const body = await awaitWithSignal(() => readBody(event), scope.signal);
        const result = await handleEvaluate(engine, body, hooks, scope);
        if (!result.ok) {
          return jsonError(result.status, result.body);
        }
        return result.data;
      } catch (error) {
        if (!event.web?.request && event.node.res.destroyed) return;
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
      } finally {
        scope.dispose();
      }
    }),
  );

  // GET /metadata
  router.get(
    `${prefix}/metadata`,
    defineEventHandler(() => {
      return handleMetadata();
    }),
  );

  // POST /evaluate/stream (SSE)
  router.post(
    `${prefix}/evaluate/stream`,
    defineEventHandler(async (event) => {
      const scope = requestScope(event);
      let transferred = false;
      try {
        const body = await awaitWithSignal(() => readBody(event), scope.signal);
        const parsed = await resolveStreamParamsWithHook(body, hooks, scope);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrl, genre, context, mode } = parsed.data;

        const response = await sendEvaluationStream(
          event,
          engine.evaluateStream(imageUrl, { genre, context, mode, signal: scope.signal }),
          scope,
          'sse',
        );
        transferred = true;
        return response;
      } catch (error) {
        if (!event.web?.request && event.node.res.destroyed) return;
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
      } finally {
        if (!transferred) scope.dispose();
      }
    }),
  );

  // POST /evaluate/stream/jsonl (Streamable HTTP - JSON Lines)
  router.post(
    `${prefix}/evaluate/stream/jsonl`,
    defineEventHandler(async (event) => {
      const scope = requestScope(event);
      let transferred = false;
      try {
        const body = await awaitWithSignal(() => readBody(event), scope.signal);
        const parsed = await resolveStreamParamsWithHook(body, hooks, scope);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrl, genre, context, mode } = parsed.data;

        const response = await sendEvaluationStream(
          event,
          engine.evaluateStream(imageUrl, { genre, context, mode, signal: scope.signal }),
          scope,
          'jsonl',
        );
        transferred = true;
        return response;
      } catch (error) {
        if (!event.web?.request && event.node.res.destroyed) return;
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
      } finally {
        if (!transferred) scope.dispose();
      }
    }),
  );

  // POST /evaluate/group
  router.post(
    `${prefix}/evaluate/group`,
    defineEventHandler(async (event) => {
      const scope = requestScope(event);
      try {
        const body = await awaitWithSignal(() => readBody(event), scope.signal);
        const result = await handleGroupEvaluate(engine, body, hooks, scope);
        if (!result.ok) {
          return jsonError(result.status, result.body);
        }
        return result.data;
      } catch (error) {
        if (!event.web?.request && event.node.res.destroyed) return;
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
      } finally {
        scope.dispose();
      }
    }),
  );

  // POST /evaluate/group/stream (SSE)
  router.post(
    `${prefix}/evaluate/group/stream`,
    defineEventHandler(async (event) => {
      const scope = requestScope(event);
      let transferred = false;
      try {
        const body = await awaitWithSignal(() => readBody(event), scope.signal);
        const parsed = await resolveGroupStreamParamsWithHook(body, hooks, scope);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

        const response = await sendEvaluationStream(
          event,
          engine.evaluateGroupStream(imageUrls, mode, {
            genre,
            context,
            includePerImage,
            mode: streamMode,
            signal: scope.signal,
          }),
          scope,
          'sse',
        );
        transferred = true;
        return response;
      } catch (error) {
        if (!event.web?.request && event.node.res.destroyed) return;
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
      } finally {
        if (!transferred) scope.dispose();
      }
    }),
  );

  // POST /evaluate/group/stream/jsonl (Streamable HTTP - JSON Lines)
  router.post(
    `${prefix}/evaluate/group/stream/jsonl`,
    defineEventHandler(async (event) => {
      const scope = requestScope(event);
      let transferred = false;
      try {
        const body = await awaitWithSignal(() => readBody(event), scope.signal);
        const parsed = await resolveGroupStreamParamsWithHook(body, hooks, scope);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

        const response = await sendEvaluationStream(
          event,
          engine.evaluateGroupStream(imageUrls, mode, {
            genre,
            context,
            includePerImage,
            mode: streamMode,
            signal: scope.signal,
          }),
          scope,
          'jsonl',
        );
        transferred = true;
        return response;
      } catch (error) {
        if (!event.web?.request && event.node.res.destroyed) return;
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
      } finally {
        if (!transferred) scope.dispose();
      }
    }),
  );

  return router;
}
