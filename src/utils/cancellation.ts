// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { AbortError } from './errors.js';

const signalErrors = new WeakMap<AbortSignal, AbortError>();

/** 只识别稳定的取消标识，不通过消息文本猜测。 */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; code?: string };
  return (
    error instanceof AbortError ||
    value.name === 'AbortError' ||
    value.name === 'APIUserAbortError' ||
    value.code === 'ABORT_ERR' ||
    value.code === 'ABORTED'
  );
}

export function toAbortError(reason?: unknown): AbortError {
  return reason instanceof AbortError ? reason : new AbortError(reason);
}

export function abortError(signal: AbortSignal): AbortError {
  let error = signalErrors.get(signal);
  if (!error) {
    error = toAbortError(signal.reason);
    signalErrors.set(signal, error);
  }
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** 在普通错误处理及重试之前调用。 */
export function rethrowAbort(error: unknown, signal?: AbortSignal): void {
  throwIfAborted(signal);
  if (isAbortError(error)) throw toAbortError(error);
}

export interface CancellationScope {
  readonly signal: AbortSignal;
  cancel(reason?: unknown): void;
  dispose(): void;
}

/** 子作用域只取消自身；结束后不再持有父信号。 */
export function createCancellationScope(parent?: AbortSignal): CancellationScope {
  const controller = new AbortController();
  let disposed = false;
  const forward = () => cancel(parent?.reason);
  const detach = () => parent?.removeEventListener('abort', forward);
  function cancel(reason?: unknown) {
    if (disposed || controller.signal.aborted) return;
    detach();
    controller.abort(toAbortError(reason));
  }
  if (parent?.aborted) cancel(parent.reason);
  else parent?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    cancel,
    dispose() {
      disposed = true;
      detach();
    },
  };
}

/**
 * 及时停止本地等待；调用方仍必须把 signal 传入真实 I/O。
 * 每次等待独立拆除监听，晚到的结果与拒绝都有人接收。
 */
export function awaitWithSignal<T>(
  operation: () => T | PromiseLike<T>,
  signal?: AbortSignal,
  onLateValue?: (value: T) => unknown,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    let pending: T | PromiseLike<T>;
    try {
      pending = operation();
    } catch (error) {
      cleanup();
      if (!settled) {
        settled = true;
        reject(signal?.aborted ? abortError(signal) : error);
      }
      return;
    }
    Promise.resolve(pending).then(
      (value) => {
        if (settled) {
          if (onLateValue) observeCleanup(() => onLateValue(value));
          return;
        }
        settled = true;
        cleanup();
        if (signal?.aborted) {
          if (onLateValue) observeCleanup(() => onLateValue(value));
          reject(abortError(signal));
        } else resolve(value);
      },
      (error) => {
        cleanup();
        if (!settled) {
          settled = true;
          reject(signal?.aborted ? abortError(signal) : error);
        }
      },
    );
  });
}

/** 清理失败不能覆盖主错误，也不能造成未处理拒绝。 */
export function observeCleanup(cleanup: () => unknown): Promise<void> {
  try {
    return Promise.resolve(cleanup()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

export function closeIterator(iterator: AsyncIterator<unknown, unknown, unknown>): Promise<void> {
  return observeCleanup(() => iterator.return?.());
}

/** 用于取消后才取得的、尚未开始消费的 SDK 流。 */
export function closeStream(stream: AsyncIterable<unknown>): Promise<void> {
  const transport = stream as AsyncIterable<unknown> & { controller?: AbortController; cancel?: () => unknown };
  transport.controller?.abort();
  if (transport.cancel) return observeCleanup(() => transport.cancel!());
  return closeIterator(stream[Symbol.asyncIterator]());
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal!));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
