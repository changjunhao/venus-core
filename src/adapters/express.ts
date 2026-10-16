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
import { nodeRequestScope, canWrite, writeNodeStream } from './streaming.js';
import type { Request, Response, NextFunction } from 'express';
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

export function createExpressAdapter(engine: VenusEngine, options?: AdapterOptions): Router {
  const router = Router();
  const prefix = options?.prefix ?? '';
  const hooks = options?.hooks;

  // POST /evaluate
  router.post(`${prefix}/evaluate`, async (req: Request, res: Response, next: NextFunction) => {
    const scope = nodeRequestScope(req, res);
    try {
      const result = await handleEvaluate(engine, req.body, hooks, scope);
      if (!canWrite(res, scope.signal)) return;
      if (!result.ok) {
        res.status(result.status).json(result.body);
        return;
      }
      res.json(result.data);
    } catch (error) {
      if (canWrite(res, scope.signal)) next(error);
    } finally {
      scope.dispose();
    }
  });

  // GET /metadata
  router.get(`${prefix}/metadata`, (_req: Request, res: Response) => {
    res.json(handleMetadata());
  });

  // POST /evaluate/stream (SSE)
  router.post(`${prefix}/evaluate/stream`, async (req: Request, res: Response, next: NextFunction) => {
    const scope = nodeRequestScope(req, res);
    try {
      const parsed = await resolveStreamParamsWithHook(req.body, hooks, scope);
      if (!canWrite(res, scope.signal)) return;
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body);
        return;
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      await writeNodeStream(
        res,
        engine.evaluateStream(imageUrl, { genre, context, mode, signal: scope.signal }),
        scope,
        'sse',
      );
    } catch (error) {
      if (canWrite(res, scope.signal)) next(error);
    } finally {
      scope.dispose();
    }
  });

  // POST /evaluate/stream/jsonl (Streamable HTTP - JSON Lines)
  router.post(`${prefix}/evaluate/stream/jsonl`, async (req: Request, res: Response, next: NextFunction) => {
    const scope = nodeRequestScope(req, res);
    try {
      const parsed = await resolveStreamParamsWithHook(req.body, hooks, scope);
      if (!canWrite(res, scope.signal)) return;
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body);
        return;
      }
      const { imageUrl, genre, context, mode } = parsed.data;

      await writeNodeStream(
        res,
        engine.evaluateStream(imageUrl, { genre, context, mode, signal: scope.signal }),
        scope,
        'jsonl',
      );
    } catch (error) {
      if (canWrite(res, scope.signal)) next(error);
    } finally {
      scope.dispose();
    }
  });

  // POST /evaluate/group
  router.post(`${prefix}/evaluate/group`, async (req: Request, res: Response, next: NextFunction) => {
    const scope = nodeRequestScope(req, res);
    try {
      const result = await handleGroupEvaluate(engine, req.body, hooks, scope);
      if (!canWrite(res, scope.signal)) return;
      if (!result.ok) {
        res.status(result.status).json(result.body);
        return;
      }
      res.json(result.data);
    } catch (error) {
      if (canWrite(res, scope.signal)) next(error);
    } finally {
      scope.dispose();
    }
  });

  // POST /evaluate/group/stream (SSE)
  router.post(`${prefix}/evaluate/group/stream`, async (req: Request, res: Response, next: NextFunction) => {
    const scope = nodeRequestScope(req, res);
    try {
      const parsed = await resolveGroupStreamParamsWithHook(req.body, hooks, scope);
      if (!canWrite(res, scope.signal)) return;
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body);
        return;
      }
      const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

      await writeNodeStream(
        res,
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
    } catch (error) {
      if (canWrite(res, scope.signal)) next(error);
    } finally {
      scope.dispose();
    }
  });

  // POST /evaluate/group/stream/jsonl (Streamable HTTP - JSON Lines)
  router.post(`${prefix}/evaluate/group/stream/jsonl`, async (req: Request, res: Response, next: NextFunction) => {
    const scope = nodeRequestScope(req, res);
    try {
      const parsed = await resolveGroupStreamParamsWithHook(req.body, hooks, scope);
      if (!canWrite(res, scope.signal)) return;
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body);
        return;
      }
      const { imageUrls, mode, genre, context, includePerImage, streamMode } = parsed.data;

      await writeNodeStream(
        res,
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
    } catch (error) {
      if (canWrite(res, scope.signal)) next(error);
    } finally {
      scope.dispose();
    }
  });

  // Error handling middleware
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (res.destroyed || res.writableEnded) return;
    const { status, body } = mapErrorToResponse(err);
    res.status(status).json(body);
  });

  return router;
}
