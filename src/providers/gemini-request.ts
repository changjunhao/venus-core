// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { ProviderError } from '../utils/errors.js';
import {
  abortableDelay,
  awaitWithSignal,
  observeCleanup,
  rethrowAbort,
  throwIfAborted,
} from '../utils/cancellation.js';
import { classifyProviderError } from './provider-errors.js';

interface RequestControl {
  signal?: AbortSignal;
  timeout: number;
  provider: string;
}

export interface GeminiRequest<T> {
  value: T;
  signal: AbortSignal;
  check(): void;
  dispose(): void;
}

/** 与 Interactions 当前默认退避一致，但等待由调用方 signal 控制。 */
export function geminiRetryDelay(error: unknown, attempt: number): number {
  const raw = error as { headers?: Headers | Record<string, string>; rawResponse?: Response } | null;
  const headers = new Headers(raw?.headers ?? raw?.rawResponse?.headers);
  const ms = headers.get('retry-after-ms');
  const after = headers.get('retry-after');
  let delay = ms === null ? 0 : Number(ms);
  if (!Number.isFinite(delay) || delay < 0) delay = 0;
  if (delay <= 0 && after) {
    const seconds = Number(after);
    delay = Number.isInteger(seconds) ? seconds * 1000 : Math.max(0, Date.parse(after) - Date.now());
  }
  if (!(delay > 0)) delay = 500 * 2 ** attempt * (1 - Math.random() * 0.25);
  return Math.min(delay, 8000);
}

/**
 * 显式 signal 会覆盖 SDK timeout，SDK 自带退避又不可取消。
 * 因此只在此处管理请求尝试，SDK create 必须配合 maxRetries: 0。
 * 成功后 deadline 的所有权交给消费者，流式读取结束时才 dispose。
 */
export async function geminiRequest<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  options: RequestControl,
  onLateValue?: (value: T) => unknown,
): Promise<GeminiRequest<T>> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(options.signal);
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      controller.abort(options.signal?.reason);
    };
    const dispose = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    };
    const check = () => {
      throwIfAborted(options.signal);
      if (timedOut) throw new ProviderError('LLM request timed out', options.provider, 'timeout');
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    if (options.timeout > 0 && !controller.signal.aborted) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, options.timeout);
    }
    try {
      const value = await awaitWithSignal(() => request(controller.signal), controller.signal, onLateValue);
      check();
      return { value, signal: controller.signal, check, dispose };
    } catch (error) {
      dispose();
      throwIfAborted(options.signal);
      const failure = timedOut ? new ProviderError('LLM request timed out', options.provider, 'timeout') : error;
      rethrowAbort(failure);
      const classified = classifyProviderError(failure, options.provider);
      const status =
        failure && typeof failure === 'object'
          ? ((failure as { status?: number; statusCode?: number }).status ??
            (failure as { statusCode?: number }).statusCode)
          : undefined;
      // HTTP 失败按状态码筛选；无状态码的连接错误及请求超时也保留请求级重试。
      const retryable =
        classified instanceof ProviderError &&
        (status === undefined
          ? classified.errorCode === 'network' || classified.errorCode === 'timeout'
          : status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600));
      if (!retryable || attempt >= 4) throw classified;
      const response = (failure as { rawResponse?: Response })?.rawResponse;
      if (response?.body) void observeCleanup(() => response.body!.cancel());
      await abortableDelay(geminiRetryDelay(failure, attempt), options.signal);
    }
  }
}
