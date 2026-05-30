// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Express Adapter
 *
 * Creates Express router for the evaluation API (backward compatibility).
 *
 * @module
 * @example
 * ```ts
 * import express from 'express';
 * import { createVenusEngine, createOpenAIChatProvider } from '@theogony/venus-core';
 * import { createExpressAdapter } from '@theogony/venus-core/express';
 *
 * const engine = createVenusEngine({
 *   provider: createOpenAIChatProvider({ baseURL: '...', apiKey: '...' }),
 * });
 * const app = express();
 * app.use('/api', createExpressAdapter(engine));
 * ```
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { VenusEngine } from '../engine.js';
import type { AdapterOptions } from '../types.js';
import {
  mapErrorToResponse,
  handleEvaluate,
  handleMetadata,
  resolveStreamParamsWithHook,
  formatSSEError,
  formatJSONLError,
} from './common.js';

export function createExpressAdapter(engine: VenusEngine, options?: AdapterOptions): Router {
  const router = Router();
  const prefix = options?.prefix ?? '';
  const hooks = options?.hooks;

  // POST /evaluate
  router.post(`${prefix}/evaluate`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await handleEvaluate(engine, req.body, hooks);
      if (!result.ok) {
        res.status(result.status).json(result.body);
        return;
      }
      res.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  // GET /metadata
  router.get(`${prefix}/metadata`, (_req: Request, res: Response) => {
    res.json(handleMetadata());
  });

  // POST /evaluate/stream (SSE)
  router.post(`${prefix}/evaluate/stream`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await resolveStreamParamsWithHook(req.body, hooks);
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body);
        return;
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        for await (const event of engine.evaluateStream(imageUrl, { genre, context, mode })) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err) {
        res.write(formatSSEError(err));
      } finally {
        res.end();
      }
    } catch (error) {
      next(error);
    }
  });

  // POST /evaluate/stream/jsonl (Streamable HTTP - JSON Lines)
  router.post(`${prefix}/evaluate/stream/jsonl`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await resolveStreamParamsWithHook(req.body, hooks);
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body);
        return;
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      try {
        for await (const event of engine.evaluateStream(imageUrl, { genre, context, mode })) {
          res.write(`${JSON.stringify(event)}\n`);
        }
      } catch (err) {
        res.write(formatJSONLError(err));
      } finally {
        res.end();
      }
    } catch (error) {
      next(error);
    }
  });

  // Error handling middleware
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = mapErrorToResponse(err);
    res.status(status).json(body);
  });

  return router;
}
