// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 共享的请求验证逻辑，供 Hono 和 Express 适配器复用
 */
import { z } from 'zod';
import type { VenusEngine } from '../engine.js';
import type { EvaluationResult } from '../types.js';
import { GenreEnum, EvaluationContextSchema, getMetadata } from '../schema/index.js';
import { VenusError, ValidationError } from '../utils/errors.js';

const EvaluationContextOptionalSchema = EvaluationContextSchema.optional();

export const evaluateRequestSchema = z.object({
  imageUrl: z.url(),
  genre: GenreEnum.optional(),
  context: EvaluationContextOptionalSchema,
  mode: z.enum(['values', 'updates']).optional(),
});

type ValidatedEvaluateRequest = z.infer<typeof evaluateRequestSchema>;

/** Parse and validate an evaluate request body, returning parsed data or a 400 error */
function parseEvaluateRequest(
  body: unknown,
):
  | { ok: true; data: ValidatedEvaluateRequest }
  | { ok: false; status: 400; body: { error: { code: string; message: string } } } {
  const parsed = evaluateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } } };
  }
  return { ok: true, data: parsed.data };
}

/** Build a stream error event object (format-agnostic) */
function buildErrorEvent(err: unknown): { type: 'error'; error: { message: string }; timestamp: number } {
  const message = err instanceof Error ? err.message : 'Internal server error';
  return { type: 'error', error: { message }, timestamp: Date.now() };
}

/** Format an error as an SSE event data string */
export function formatSSEError(err: unknown): string {
  return `data: ${JSON.stringify(buildErrorEvent(err))}\n\n`;
}

/** Format an error as a JSON Lines (x-ndjson) line */
export function formatJSONLError(err: unknown): string {
  return `${JSON.stringify(buildErrorEvent(err))}\n`;
}

// ============================================================
// 共享路由处理逻辑
// ============================================================

/** Shared POST /evaluate handler: validate body → call engine.evaluate */
export async function handleEvaluate(
  engine: VenusEngine,
  body: unknown,
): Promise<
  { ok: true; data: EvaluationResult } | { ok: false; status: 400; body: { error: { code: string; message: string } } }
> {
  const parsed = parseEvaluateRequest(body);
  if (!parsed.ok) return parsed;
  const { imageUrl, genre, context } = parsed.data;
  const result = await engine.evaluate(imageUrl, genre ?? null, context);
  return { ok: true, data: result };
}

/** Shared GET /metadata handler */
export { getMetadata as handleMetadata };

/** Shared stream route: validate body → extract stream params */
export function resolveStreamParams(body: unknown): ReturnType<typeof parseEvaluateRequest> {
  return parseEvaluateRequest(body);
}

// ============================================================
// 错误映射
// ============================================================

/** Map an error to a framework-agnostic HTTP response { status, body } */
export function mapErrorToResponse(error: unknown): {
  status: 400 | 422 | 500;
  body: { error: { code: string; message: string } };
} {
  if (error instanceof ValidationError) {
    return { status: 400, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof VenusError) {
    return { status: 422, body: { error: { code: error.code, message: error.message } } };
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message } } };
}
