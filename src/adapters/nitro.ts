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
import type { Router } from 'h3';
import type { VenusEngine } from '../engine.js';
import type { AdapterOptions } from '../types.js';
import {
  mapErrorToResponse,
  handleEvaluate,
  handleMetadata,
  handleGroupEvaluate,
  resolveStreamParamsWithHook,
  resolveGroupStreamParamsWithHook,
  formatSSEError,
  formatJSONLError,
} from './common.js';

/** Build a JSON error response with an explicit status code */
function jsonError(status: number, body: { error: { code: string; message: string } }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createNitroAdapter(engine: VenusEngine, options?: AdapterOptions): Router {
  const router = createRouter();
  const prefix = options?.prefix ?? '';
  const hooks = options?.hooks;

  // POST /evaluate
  router.post(
    `${prefix}/evaluate`,
    defineEventHandler(async (event) => {
      try {
        const body = await readBody(event);
        const result = await handleEvaluate(engine, body, hooks);
        if (!result.ok) {
          return jsonError(result.status, result.body);
        }
        return result.data;
      } catch (error) {
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
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
      try {
        const body = await readBody(event);
        const parsed = await resolveStreamParamsWithHook(body, hooks);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrl, genre, context, mode } = parsed.data;

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              try {
                for await (const chunk of engine.evaluateStream(imageUrl, { genre, context, mode })) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
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
        return jsonError(status, body);
      }
    }),
  );

  // POST /evaluate/stream/jsonl (Streamable HTTP - JSON Lines)
  router.post(
    `${prefix}/evaluate/stream/jsonl`,
    defineEventHandler(async (event) => {
      try {
        const body = await readBody(event);
        const parsed = await resolveStreamParamsWithHook(body, hooks);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrl, genre, context, mode } = parsed.data;

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              try {
                for await (const chunk of engine.evaluateStream(imageUrl, { genre, context, mode })) {
                  controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
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
        return jsonError(status, body);
      }
    }),
  );

  // POST /evaluate/group
  router.post(
    `${prefix}/evaluate/group`,
    defineEventHandler(async (event) => {
      try {
        const body = await readBody(event);
        const result = await handleGroupEvaluate(engine, body, hooks);
        if (!result.ok) {
          return jsonError(result.status, result.body);
        }
        return result.data;
      } catch (error) {
        const { status, body } = mapErrorToResponse(error);
        return jsonError(status, body);
      }
    }),
  );

  // POST /evaluate/group/stream (SSE)
  router.post(
    `${prefix}/evaluate/group/stream`,
    defineEventHandler(async (event) => {
      try {
        const body = await readBody(event);
        const parsed = await resolveGroupStreamParamsWithHook(body, hooks);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              try {
                for await (const chunk of engine.evaluateGroupStream(imageUrls, mode, {
                  genre,
                  context,
                  includePerImage,
                  mode: streamMode,
                })) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
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
        return jsonError(status, body);
      }
    }),
  );

  // POST /evaluate/group/stream/jsonl (Streamable HTTP - JSON Lines)
  router.post(
    `${prefix}/evaluate/group/stream/jsonl`,
    defineEventHandler(async (event) => {
      try {
        const body = await readBody(event);
        const parsed = await resolveGroupStreamParamsWithHook(body, hooks);
        if (!parsed.ok) {
          return jsonError(parsed.status, parsed.body);
        }
        const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              try {
                for await (const chunk of engine.evaluateGroupStream(imageUrls, mode, {
                  genre,
                  context,
                  includePerImage,
                  mode: streamMode,
                })) {
                  controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
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
        return jsonError(status, body);
      }
    }),
  );

  return router;
}
