// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import {
  abortError,
  awaitWithSignal,
  closeIterator,
  createCancellationScope,
  isAbortError,
  observeCleanup,
  throwIfAborted,
  toAbortError,
  type CancellationScope,
} from './cancellation.js';

/**
 * 原生生成器的 return 会排在待决 next 后面；外壳先同步 abort，才请求内部收尾。
 * complete 必须在交付业务终态前调用，以免读到最终结果后 break 被当作取消。
 */
export function cancellableStream<T, R = void>(
  factory: (signal: AbortSignal, complete: () => void) => AsyncGenerator<T, R, unknown>,
  parent?: AbortSignal,
  onCancel?: () => void,
): AsyncGenerator<T, R, unknown> {
  let scope: CancellationScope | undefined;
  let inner: AsyncGenerator<T, R, unknown> | undefined;
  let terminal = false;
  let returned = false;
  let cancelled = false;
  let reported = false;
  let closing: Promise<void> | undefined;
  let throwing: { error: unknown } | undefined;
  let queue = Promise.resolve();
  const ended = (value?: R): IteratorResult<T, R> => ({ done: true, value: value as R });

  const dispose = () => {
    scope?.signal.removeEventListener('abort', onAbort);
    scope?.dispose();
  };
  const complete = () => {
    terminal = true;
    dispose();
  };
  const close = (): Promise<void> => {
    if (!inner) return Promise.resolve();
    return (closing ??= throwing ? observeCleanup(() => inner!.throw(throwing!.error)) : closeIterator(inner));
  };
  const onAbort = () => {
    if (terminal || cancelled) return;
    cancelled = true;
    // 网络中止由 scope 同步向下传播；这里不等待外部迭代器可能永不结束的 return。
    close();
    dispose();
    if (onCancel) void observeCleanup(onCancel);
  };

  const iterator: AsyncGenerator<T, R, unknown> = {
    next(...args: [] | [unknown]) {
      const run = async (): Promise<IteratorResult<T, R>> => {
        if (returned) return ended();
        if (cancelled) {
          if (reported) return ended();
          reported = true;
          throw abortError(scope!.signal);
        }
        if (terminal && !inner) return ended();
        try {
          if (!inner) {
            throwIfAborted(parent);
            scope = createCancellationScope(parent);
            scope.signal.addEventListener('abort', onAbort, { once: true });
            inner = factory(scope.signal, complete);
          }
          const result = await awaitWithSignal(() => inner!.next(...args), terminal ? undefined : scope!.signal);
          // 内部读取兑现后到本次 await 恢复前仍可能取消；已提交的终态不受迟到取消影响。
          if (!terminal) throwIfAborted(scope!.signal);
          if (result.done) complete();
          return result;
        } catch (error) {
          if (scope?.signal.aborted || isAbortError(error)) {
            if (!terminal) scope?.cancel(error);
            reported = true;
            if (!scope) terminal = true;
            throw scope?.signal.aborted ? abortError(scope.signal) : toAbortError(error);
          }
          terminal = true;
          close();
          dispose();
          throw error;
        }
      };
      const result = queue.then(run);
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    return(value: R | PromiseLike<R>) {
      returned = true;
      if (!terminal) scope?.cancel();
      const cleanup = close();
      dispose();
      return cleanup.then(() => value).then(ended);
    },
    throw(error: unknown) {
      returned = true;
      throwing = { error };
      if (!terminal) scope?.cancel(error);
      const cleanup = close();
      dispose();
      return cleanup.then(() => {
        throw error;
      });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    async [Symbol.asyncDispose]() {
      await closeIterator(iterator);
    },
  };
  return iterator;
}

/** 消费 Provider 的普通 AsyncIterable；退出先释放本地资源，再尽力关闭上游。 */
export async function* abortableChunks<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let done = false;
  try {
    while (true) {
      const next = await awaitWithSignal(() => iterator.next(), signal);
      throwIfAborted(signal);
      if (next.done) {
        done = true;
        return;
      }
      yield next.value;
      throwIfAborted(signal);
    }
  } finally {
    if (!done) void closeIterator(iterator);
  }
}
