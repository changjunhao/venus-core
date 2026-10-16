// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  abortError,
  awaitWithSignal,
  closeIterator,
  createCancellationScope,
  isAbortError,
  throwIfAborted,
  type CancellationScope,
} from '../utils/cancellation.js';
import { formatJSONLError, formatSSEError } from './common.js';

export type StreamFormat = 'sse' | 'jsonl';

export function streamHeaders(format: StreamFormat): Record<string, string> {
  return {
    'Content-Type': format === 'sse' ? 'text/event-stream' : 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...(format === 'jsonl' ? { 'X-Accel-Buffering': 'no' } : {}),
  };
}

function encodeEvent(event: unknown, format: StreamFormat): string {
  const json = JSON.stringify(event);
  return format === 'sse' ? `data: ${json}\n\n` : `${json}\n`;
}

function encodeError(error: unknown, format: StreamFormat): string {
  return format === 'sse' ? formatSSEError(error) : formatJSONLError(error);
}

export function canWrite(res: ServerResponse, signal: AbortSignal): boolean {
  return !signal.aborted && !res.destroyed && !res.writableEnded;
}

/** req.close 可能仅表示请求体已完整读取，不能作为取消依据。 */
export function nodeRequestScope(req: IncomingMessage, res: ServerResponse): CancellationScope {
  const scope = createCancellationScope();
  const aborted = () => scope.cancel();
  const closed = () => {
    if (!res.writableFinished) scope.cancel();
  };
  const failed = (error: Error) => scope.cancel(error);
  const dispose = () => {
    req.removeListener('aborted', aborted);
    res.removeListener('close', closed);
    res.removeListener('error', failed);
    res.removeListener('finish', dispose);
    scope.dispose();
  };
  req.once('aborted', aborted);
  res.once('close', closed);
  res.once('error', failed);
  res.once('finish', dispose);
  if (req.aborted || res.destroyed) scope.cancel();
  return { signal: scope.signal, cancel: scope.cancel, dispose };
}

/** 等待背压时同样响应断连，所有临时监听在完成后移除。 */
export function waitForDrain(res: ServerResponse, signal: AbortSignal): Promise<void> {
  if (!canWrite(res, signal)) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.removeListener('drain', drained);
      res.removeListener('close', stopped);
      res.removeListener('error', stopped);
      signal.removeEventListener('abort', stopped);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const stopped = () => {
      cleanup();
      reject(abortError(signal));
    };
    res.once('drain', drained);
    res.once('close', stopped);
    res.once('error', stopped);
    signal.addEventListener('abort', stopped, { once: true });
    if (!canWrite(res, signal)) stopped();
    else if (!res.writableNeedDrain) drained();
  });
}

export async function writeNodeStream(
  res: ServerResponse,
  iterator: AsyncIterator<unknown>,
  scope: CancellationScope,
  format: StreamFormat,
): Promise<void> {
  const { signal } = scope;
  try {
    throwIfAborted(signal);
    if (!canWrite(res, signal)) {
      scope.cancel();
      return;
    }
    for (const [name, value] of Object.entries(streamHeaders(format))) res.setHeader(name, value);
    res.flushHeaders();
    while (canWrite(res, signal)) {
      const next = await awaitWithSignal(() => iterator.next(), signal);
      if (next.done) break;
      if (!canWrite(res, signal)) break;
      const frame = encodeEvent(next.value, format);
      if (!canWrite(res, signal)) break;
      if (!res.write(frame)) await waitForDrain(res, signal);
    }
  } catch (error) {
    if (!isAbortError(error) && canWrite(res, signal)) {
      if (!res.write(encodeError(error, format))) {
        try {
          await waitForDrain(res, signal);
        } catch {
          /* 连接已关闭，无需再次响应。 */
        }
      }
    }
  } finally {
    void closeIterator(iterator);
    if (canWrite(res, signal)) res.end();
    scope.dispose();
  }
}

/** 按需读取；返回 Response 时，生命周期仍由流持有。 */
export function webEventStream(
  iterator: AsyncIterator<unknown>,
  scope: CancellationScope,
  format: StreamFormat,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const dispose = () => {
    scope.signal.removeEventListener('abort', aborted);
    scope.dispose();
    void closeIterator(iterator);
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    controller.close();
    dispose();
  };
  const aborted = () => finish();
  return new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
        scope.signal.addEventListener('abort', aborted, { once: true });
        if (scope.signal.aborted) aborted();
      },
      async pull() {
        if (closed) return;
        try {
          const next = await awaitWithSignal(() => iterator.next(), scope.signal);
          if (closed) return;
          if (next.done) {
            finish();
            return;
          }
          const frame = encoder.encode(encodeEvent(next.value, format));
          if (!closed && !scope.signal.aborted) controller.enqueue(frame);
        } catch (error) {
          if (closed) return;
          if (!scope.signal.aborted && !isAbortError(error))
            controller.enqueue(encoder.encode(encodeError(error, format)));
          finish();
        }
      },
      cancel(reason) {
        if (closed) return;
        closed = true;
        scope.cancel(reason);
        dispose();
      },
    },
    { highWaterMark: 0 },
  );
}
