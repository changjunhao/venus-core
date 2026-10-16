// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { AbortError } from '../../src/utils/errors.js';
import { createCancellationScope } from '../../src/utils/cancellation.js';
import { streamHeaders, webEventStream } from '../../src/adapters/streaming.js';
import { deferred, watchdog } from '../helpers/cancellation.js';

async function* emitThenHang(events: unknown[], gate: Promise<void>): AsyncGenerator<unknown> {
  for (const event of events) yield event;
  await gate;
  yield 'never-reached';
}

describe('webEventStream', () => {
  it('按需推进；reader.cancel 触发 scope abort 且不再 enqueue', async () => {
    const gate = deferred<void>();
    const scope = createCancellationScope();
    const stream = webEventStream(emitThenHang([{ type: 'a' }, { type: 'b' }], gate.promise), scope, 'sse');
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe('data: {"type":"a"}\n\n');
    await reader.cancel('user abort');
    expect(scope.signal.aborted).toBe(true);
    gate.resolve();
  });

  it('scope abort 时暂停中的 pull 立即结束', async () => {
    const gate = deferred<void>();
    const scope = createCancellationScope();
    const stream = webEventStream(emitThenHang([{ type: 'x' }], gate.promise), scope, 'sse');
    const reader = stream.getReader();
    await reader.read();
    const pending = reader.read();
    scope.cancel();
    const result = await watchdog(pending);
    expect(result.done).toBe(true);
    gate.resolve();
  });

  it('scope abort 后 iterator 抛 AbortError 不 emit error 帧', async () => {
    const scope = createCancellationScope();
    const throwing: AsyncGenerator<unknown> = (async function* () {
      yield { type: 'ok' };
      await new Promise<never>((_, reject) => {
        scope.signal.addEventListener('abort', () => reject(new AbortError()), { once: true });
      });
      yield { type: 'never' };
    })();
    const stream = webEventStream(throwing[Symbol.asyncIterator](), scope, 'jsonl');
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first.trim()).toBe('{"type":"ok"}');
    scope.cancel();
    const second = await reader.read();
    expect(second.done).toBe(true);
  });
});

describe('streamHeaders', () => {
  it('SSE 与 JSONL 头保持原有语义', () => {
    const sse = streamHeaders('sse');
    expect(sse['Content-Type']).toBe('text/event-stream');
    expect(sse['X-Accel-Buffering']).toBeUndefined();
    const jsonl = streamHeaders('jsonl');
    expect(jsonl['Content-Type']).toBe('application/x-ndjson');
    expect(jsonl['X-Accel-Buffering']).toBe('no');
  });
});
