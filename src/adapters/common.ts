// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 共享的请求验证逻辑，供 Hono 和 Express 适配器复用
 */
import { z } from 'zod';
import type { VenusEngine } from '../engine.js';
import type { AdapterHooks, EvaluateParams, EvaluationResult } from '../types.js';
import { GenreEnum, EvaluationContextSchema, getMetadata } from '../schema/index.js';
import { VenusError, ValidationError } from '../utils/errors.js';

const EvaluationContextOptionalSchema = EvaluationContextSchema.optional();

// ============================================================
// imageUrl SSRF 防护
// ============================================================

/** 判断主机名是否指向私有/保留地址（loopback、RFC 1918、link-local、云元数据等） */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  // IPv6 loopback / unspecified / link-local / unique-local
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}

/**
 * imageUrl 校验：仅对 http/https 拦截私有/保留主机（SSRF 防护）；
 * 其他协议（data:、oss:、gs:、cos: 等厂商私有协议）由提供者自行解析，直接放行
 */
export function isAllowedImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  return !isPrivateHost(url.hostname);
}

export const evaluateRequestSchema = z.object({
  imageUrl: z.url().refine(isAllowedImageUrl, {
    message: 'imageUrl must not target a private or reserved host',
  }),
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

/**
 * Apply the optional `beforeEvaluate` hook to validated params.
 *
 * Returns the params unchanged when no hook is configured, otherwise awaits
 * the hook (sync or async) and returns its transformed result.
 */
export async function applyBeforeEvaluateHook(params: EvaluateParams, hooks?: AdapterHooks): Promise<EvaluateParams> {
  if (!hooks?.beforeEvaluate) return params;
  return await hooks.beforeEvaluate(params);
}

/** Shared POST /evaluate handler: validate body → apply hook → call engine.evaluate */
export async function handleEvaluate(
  engine: VenusEngine,
  body: unknown,
  hooks?: AdapterHooks,
): Promise<
  { ok: true; data: EvaluationResult } | { ok: false; status: 400; body: { error: { code: string; message: string } } }
> {
  const parsed = parseEvaluateRequest(body);
  if (!parsed.ok) return parsed;
  const params = await applyBeforeEvaluateHook(
    {
      imageUrl: parsed.data.imageUrl,
      genre: parsed.data.genre ?? null,
      context: parsed.data.context,
    },
    hooks,
  );
  const result = await engine.evaluate(params.imageUrl, params.genre, params.context);
  return { ok: true, data: result };
}

/** Shared GET /metadata handler */
export { getMetadata as handleMetadata };

/**
 * Resolve stream params and apply the optional `beforeEvaluate` hook.
 *
 * On success the returned `data` is already in engine-ready shape
 * (`genre: Genre | null`, `mode` defaulted from request, hook transformations
 * applied). On validation failure returns a 400 error shape with a
 * `VALIDATION_ERROR` code.
 */
export async function resolveStreamParamsWithHook(
  body: unknown,
  hooks?: AdapterHooks,
): Promise<
  { ok: true; data: EvaluateParams } | { ok: false; status: 400; body: { error: { code: string; message: string } } }
> {
  const parsed = parseEvaluateRequest(body);
  if (!parsed.ok) return parsed;
  const params = await applyBeforeEvaluateHook(
    {
      imageUrl: parsed.data.imageUrl,
      genre: parsed.data.genre ?? null,
      context: parsed.data.context,
      mode: parsed.data.mode,
    },
    hooks,
  );
  return { ok: true, data: params };
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
