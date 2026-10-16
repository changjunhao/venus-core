// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect, mock, spyOn } from 'bun:test';
import { AbortError, ProviderError } from '../../src/utils/errors.js';
import {
  abortableDelay,
  awaitWithSignal,
  createCancellationScope,
  isAbortError,
  throwIfAborted,
} from '../../src/utils/cancellation.js';
import { cancellableStream } from '../../src/utils/cancellable-stream.js';
import { deferred, watchdog } from '../helpers/cancellation.js';

describe('取消基础契约', () => {
  it('保留本地原因，不泄漏到消息；识别稳定标识', () => {
    const reason = new Error('private reason');
    const error = new AbortError(reason);
    expect(error.reason).toBe(reason);
    expect(error.cause).toBe(reason);
    expect(error.message).not.toContain('private');
    expect(error.code).toBe('ABORTED');
    expect(isAbortError(new DOMException('stop', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'APIUserAbortError' })).toBe(true);
    expect(isAbortError(new Error('abort mentioned'))).toBe(false);
    expect(isAbortError(new ProviderError('timeout', 'test', 'timeout'))).toBe(false);
  });

  it('子作用域隔离，重复检查复用取消错误', () => {
    const parent = new AbortController();
    const a = createCancellationScope(parent.signal);
    const b = createCancellationScope(parent.signal);
    a.cancel('first');
    a.cancel('second');
    expect(parent.signal.aborted).toBe(false);
    expect(b.signal.aborted).toBe(false);
    let error: unknown;
    try {
      throwIfAborted(a.signal);
    } catch (caught) {
      error = caught;
    }
    try {
      throwIfAborted(a.signal);
    } catch (caught) {
      expect(caught).toBe(error);
    }
    b.dispose();
    parent.abort();
    expect(b.signal.aborted).toBe(false);
  });

  it('预取消不调用工厂；晚到结果仍被清理', async () => {
    const controller = new AbortController();
    controller.abort('stop');
    const operation = mock(() => 1);
    await expect(awaitWithSignal(operation, controller.signal)).rejects.toBeInstanceOf(AbortError);
    expect(operation).not.toHaveBeenCalled();
    const running = new AbortController();
    const gate = deferred<number>();
    const cleaned = deferred<number>();
    const pending = awaitWithSignal(
      () => gate.promise,
      running.signal,
      (value) => cleaned.resolve(value),
    );
    running.abort();
    await expect(pending).rejects.toBeInstanceOf(AbortError);
    gate.resolve(5);
    expect(await watchdog(cleaned.promise)).toBe(5);
  });

  it('退避取消及时结束等待', async () => {
    const controller = new AbortController();
    const pending = abortableDelay(60_000, controller.signal);
    controller.abort();
    await expect(watchdog(pending)).rejects.toBeInstanceOf(AbortError);
  });

  it('未开始消费就 return 不执行工厂', async () => {
    const called = mock();
    const stream = cancellableStream(async function* () {
      called();
      yield 1;
    });
    expect(await stream.return()).toEqual({ done: true, value: undefined });
    expect(await stream.next()).toEqual({ done: true, value: undefined });
    expect(called).not.toHaveBeenCalled();
  });

  it('return 在 next 挂起时同步中止，finally 能执行', async () => {
    const started = deferred<AbortSignal>();
    const cleaned = deferred();
    const stream = cancellableStream(async function* (signal) {
      try {
        started.resolve(signal);
        await awaitWithSignal(() => new Promise<never>(() => {}), signal);
        yield 1;
      } finally {
        cleaned.resolve();
      }
    });
    const next = stream.next();
    const signal = await started.promise;
    const closing = stream.return();
    expect(signal.aborted).toBe(true);
    await expect(next).rejects.toBeInstanceOf(AbortError);
    await closing;
    await watchdog(cleaned.promise);
  });

  it.each(['signal', 'return'] as const)('%s 在读取已兑现但尚未交付时取消，不泄漏业务事件', async (mode) => {
    const controller = new AbortController();
    const cancelled = mock();
    const started = deferred();
    const gate = deferred<IteratorResult<number, void>>();
    const inner = (async function* () {
      yield 2;
    })();
    const next = spyOn(inner, 'next').mockImplementationOnce(() => {
      started.resolve();
      return gate.promise;
    });
    const stream = cancellableStream(() => inner, controller.signal, cancelled);
    const reads = Promise.allSettled([stream.next(), stream.next(), stream.next()]);
    let closing: Promise<IteratorResult<number, void>> | undefined;
    await started.promise;
    gate.resolve({ done: false, value: 1 });
    // gate 的兑现回调先运行，取消微任务随后执行，外层 await 最后才恢复。
    queueMicrotask(() => {
      if (mode === 'signal') controller.abort();
      else closing = stream.return();
    });
    const [first, ...queued] = await watchdog(reads);
    expect(first?.status).toBe('rejected');
    if (first?.status === 'rejected') expect(first.reason).toBeInstanceOf(AbortError);
    expect(queued).toEqual([
      { status: 'fulfilled', value: { done: true, value: undefined } },
      { status: 'fulfilled', value: { done: true, value: undefined } },
    ]);
    if (closing) await watchdog(closing);
    expect(await stream.next()).toEqual({ done: true, value: undefined });
    expect(next).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('暂停于 yield 时 signal 取消也清理，下一次读取只报告一次取消', async () => {
    const controller = new AbortController();
    const cleaned = deferred();
    const cancelled = mock();
    const stream = cancellableStream(
      async function* () {
        try {
          yield 1;
          yield 2;
        } finally {
          cleaned.resolve();
        }
      },
      controller.signal,
      cancelled,
    );
    expect((await stream.next()).value).toBe(1);
    controller.abort();
    await watchdog(cleaned.promise);
    await expect(stream.next()).rejects.toBeInstanceOf(AbortError);
    expect((await stream.next()).done).toBe(true);
    await stream.return();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('已提交成功终态后 break 不报告取消', async () => {
    const controller = new AbortController();
    const cancelled = mock();
    const stream = cancellableStream(
      async function* (_signal, complete) {
        complete();
        queueMicrotask(() => controller.abort());
        yield 42;
      },
      controller.signal,
      cancelled,
    );
    expect((await stream.next()).value).toBe(42);
    expect(controller.signal.aborted).toBe(true);
    await stream.return();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('正常生成器返回值完整保留', async () => {
    const stream = cancellableStream(async function* () {
      yield 1;
      return { score: 9 };
    });
    expect(await stream.next()).toEqual({ done: false, value: 1 });
    expect(await stream.next()).toEqual({ done: true, value: { score: 9 } });
  });
});
