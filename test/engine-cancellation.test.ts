// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { createVenusEngine } from '../src/engine.js';
import { defineProvider } from '../src/providers/index.js';
import { AbortError } from '../src/utils/errors.js';
import type { ChatParams, EvaluationEvent, LLMProvider } from '../src/types.js';
import { watchdog } from './helpers/cancellation.js';
import { PORTRAIT_DIMS, makeDimensions } from './helpers/mock-data.js';

const IMG = 'https://example.com/photo.jpg';

function proposalJSON(): string {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.5,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
    critique: 'ok',
    suggestions: ['ok'],
  });
}
function critiqueJSON(severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'): string {
  return JSON.stringify({
    scene_type_review: { proposer_scene: 'studio', is_correct: true, correct_scene: null, reason: 'ok' },
    challenges: [],
    severity,
    overall_assessment: 'ok',
    suggested_total_score: 7.2,
  });
}
function arbiterJSON(): string {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    critique: 'ok',
    suggestions: ['ok'],
    arbitration_notes: { scene_type_ruling: 'ok', decisions: [], final_rationale: 'ok' },
  });
}

/** 挂起 Provider：只在 signal abort 时 reject；用于验证在途取消。 */
function hangingProvider(name: string, sink: { signals: AbortSignal[]; calls: number }): LLMProvider {
  return defineProvider({
    name,
    capabilities: { vision: true, reasoning: false, reasoningBudget: false, streaming: false },
    chat: (params: ChatParams) =>
      new Promise((_resolve, reject) => {
        sink.calls++;
        sink.signals.push(params.signal!);
        const onAbort = () => reject(new DOMException('abort', 'AbortError'));
        if (params.signal?.aborted) onAbort();
        else params.signal?.addEventListener('abort', onAbort, { once: true });
      }),
  });
}

describe('Engine 取消契约', () => {
  it('预取消的 evaluate 不调用任何 Provider', async () => {
    const sink = { signals: [] as AbortSignal[], calls: 0 };
    const engine = createVenusEngine({ provider: hangingProvider('h', sink), defaultModel: 'm', maxRetries: 1 });
    const c = new AbortController();
    c.abort();
    await expect(engine.evaluate(IMG, 'portrait', undefined, { signal: c.signal })).rejects.toBeInstanceOf(AbortError);
    expect(sink.calls).toBe(0);
  });

  it('取消后不再启动下一轮 Agent', async () => {
    const c = new AbortController();
    const events: EvaluationEvent[] = [];
    const proposerSink = { signals: [] as AbortSignal[], calls: 0 };
    const criticSink = { signals: [] as AbortSignal[], calls: 0 };
    const arbiterSink = { signals: [] as AbortSignal[], calls: 0 };
    const engine = createVenusEngine({
      provider: hangingProvider('default', { signals: [], calls: 0 }),
      defaultModel: 'm',
      maxRetries: 1,
      providers: {
        proposer: hangingProvider('proposer', proposerSink),
        critic: hangingProvider('critic', criticSink),
        arbiter: hangingProvider('arbiter', arbiterSink),
      },
      onEvent: (event) => events.push(event),
    });
    const pending = engine.evaluate(IMG, 'portrait', undefined, { signal: c.signal });
    // 让提案者先启动
    await new Promise((r) => setImmediate(r));
    c.abort();
    await expect(watchdog(pending)).rejects.toBeInstanceOf(AbortError);
    expect(proposerSink.calls).toBe(1);
    expect(criticSink.calls).toBe(0);
    expect(arbiterSink.calls).toBe(0);
    // cancelled 至多一次；error 不再触发
    expect(events.filter((e) => e.type === 'cancelled').length).toBeLessThanOrEqual(1);
    expect(events.filter((e) => e.type === 'error').length).toBe(0);
  });

  it('evaluateStream 消费者 break 触发 abort', async () => {
    const sink = { signals: [] as AbortSignal[], calls: 0 };
    const provider = hangingProvider('stream-hang', sink);
    const engine = createVenusEngine({ provider, defaultModel: 'm', maxRetries: 1 });
    const stream = engine.evaluateStream(IMG, { genre: 'portrait', mode: 'updates' });
    const iterator = stream[Symbol.asyncIterator]();
    // 多推进一步，让 agent_call 后 Provider 已开始；next 会挂起在 provider.chat。
    await iterator.next(); // evaluation_start
    await iterator.next(); // agent_call
    // 下一个 next 将启动 proposer 的 provider.chat（当前挂起）
    const pending = iterator.next();
    // 确保 provider 已被调用
    for (let i = 0; i < 20 && sink.calls === 0; i++) await new Promise((r) => setImmediate(r));
    expect(sink.calls).toBe(1);
    const returning = iterator.return?.();
    await watchdog(Promise.resolve(returning));
    // 取消后已启动的 provider 信号必然 aborted
    expect(sink.signals.every((s) => s.aborted)).toBe(true);
    // pending 的读取会因 abort 而拒绝或 done（两者都是合法收尾）
    try {
      await pending;
    } catch (e) {
      expect(e).toBeInstanceOf(AbortError);
    }
  });

  it('并发请求互不影响', async () => {
    // 为每个角色使用确定响应的 mock provider（按调用顺序返回）
    const makeRole = (name: string, responses: string[]) => {
      let i = 0;
      return defineProvider({
        name,
        capabilities: { vision: true, reasoning: false, reasoningBudget: false, streaming: false },
        chat: async (params: ChatParams) => {
          if (params.signal?.aborted) throw new DOMException('abort', 'AbortError');
          // 在挂起中支持中途取消
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => reject(new DOMException('abort', 'AbortError'));
            params.signal?.addEventListener('abort', onAbort, { once: true });
            const t = setTimeout(() => {
              params.signal?.removeEventListener('abort', onAbort);
              resolve();
            }, 15);
            t.unref?.();
          });
          const content = responses[i++] ?? responses[responses.length - 1]!;
          return { content, reasoning: null };
        },
      });
    };
    const mkEngine = () =>
      createVenusEngine({
        provider: makeRole('d', []),
        defaultModel: 'm',
        maxRetries: 1,
        providers: {
          proposer: makeRole('p', [proposalJSON()]),
          critic: makeRole('c', [critiqueJSON('LOW')]),
          arbiter: makeRole('a', [arbiterJSON()]),
        },
      });
    const aCtl = new AbortController();
    const bCtl = new AbortController();
    const a = mkEngine().evaluate(IMG, 'portrait', undefined, { signal: aCtl.signal });
    const b = mkEngine().evaluate(IMG, 'portrait', undefined, { signal: bCtl.signal });
    bCtl.abort();
    await expect(b).rejects.toBeInstanceOf(AbortError);
    const result = await watchdog(a);
    expect(result.genre).toBe('portrait');
    expect(result.totalScore).toBe(7.2);
  });
});
